import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEMP_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-leave-notify-')), 'test.sqlite');
process.env.NODE_ENV = 'development';
process.env.SQLITE_FILE = TEMP_DB;
process.env.JWT_SECRET = 'test-secret-for-vitest-only';

let db: any;
let server: Server;
let baseUrl: string;
let csrToken: string;
let adminToken: string;
let secondAdminToken: string;

const CSR_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CSR_ID = '44444444-4444-4444-8444-444444444444';

async function createSchema() {
  await db.schema.createTable('users', (t: any) => {
    t.uuid('id').primary();
    t.string('email').unique().notNullable();
    t.string('password_hash').notNullable();
    t.string('name').notNullable();
    t.string('role').defaultTo('csr');
    t.string('status').defaultTo('active');
    t.string('segment');
    t.string('employment_type').defaultTo('Full Time');
    t.string('location').defaultTo('Ulaanbaatar');
    t.dateTime('sessions_valid_from');
    t.timestamps(true, true);
  });

  await db.schema.createTable('leave_requests', (t: any) => {
    t.uuid('id').primary();
    t.uuid('user_id').notNullable();
    t.date('date').notNullable();
    t.date('end_date');
    t.time('start_time');
    t.time('end_time');
    t.string('reason').notNullable();
    t.string('type').defaultTo('hourly');
    t.string('status').defaultTo('pending');
    t.string('user_name');
    t.string('user_code');
    t.uuid('approved_by');
    t.text('comment');
    t.timestamps(true, true);
  });

  await db.schema.createTable('notifications', (t: any) => {
    t.uuid('id').primary();
    t.string('title').notNullable();
    t.text('content').notNullable();
    t.string('image_url');
    t.dateTime('deadline');
    t.string('type').defaultTo('general');
    t.uuid('target_user_id');
    t.string('related_entity_type');
    t.string('related_entity_id');
    t.uuid('author_id');
    t.timestamps(true, true);
  });

  await db.schema.createTable('notification_read_receipts', (t: any) => {
    t.uuid('notification_id').notNullable();
    t.uuid('user_id').notNullable();
    t.dateTime('read_at');
    t.primary(['notification_id', 'user_id']);
  });
}

async function api(method: string, route: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default;
  db = (await import('../../database/db')).default;
  await createSchema();

  await db('users').insert([
    { id: CSR_ID, email: 'csr@test.mn', password_hash: 'x', name: 'CSR One', role: 'csr', status: 'active', segment: 'VIP', employment_type: 'Full Time', location: 'Ulaanbaatar' },
    { id: OTHER_CSR_ID, email: 'othercsr@test.mn', password_hash: 'x', name: 'Other CSR', role: 'csr', status: 'active', segment: 'VIP', employment_type: 'Full Time', location: 'Ulaanbaatar' },
    { id: ADMIN_ID, email: 'admin1@test.mn', password_hash: 'x', name: 'Admin One', role: 'admin', status: 'active', segment: 'System Control', employment_type: 'Full Time', location: 'Ulaanbaatar' },
    { id: SECOND_ADMIN_ID, email: 'admin2@test.mn', password_hash: 'x', name: 'Admin Two', role: 'admin', status: 'active', segment: 'System Control', employment_type: 'Full Time', location: 'Ulaanbaatar' },
  ]);

  const requestsRoutes = (await import('../requests')).default;
  const broadcastsRoutes = (await import('../broadcasts')).default;

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/requests', requestsRoutes);
  app.use('/api/broadcasts', broadcastsRoutes);

  csrToken = jwt.sign({ id: CSR_ID, email: 'csr@test.mn', role: 'csr', name: 'CSR One' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
  adminToken = jwt.sign({ id: ADMIN_ID, email: 'admin1@test.mn', role: 'admin', name: 'Admin One' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
  secondAdminToken = jwt.sign({ id: SECOND_ADMIN_ID, email: 'admin2@test.mn', role: 'admin', name: 'Admin Two' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.destroy();
  fs.rmSync(path.dirname(TEMP_DB), { recursive: true, force: true });
});

beforeEach(async () => {
  await db('notifications').del();
  await db('notification_read_receipts').del();
  await db('leave_requests').del();
});

describe('leave request notifications', () => {
  it('sends one exact notification to the requester and admin copies that identify the acting admin and requester', async () => {
    const createLeave = await api('POST', '/api/requests/leave', csrToken, {
      date: '2026-10-05',
      endDate: '2026-10-05',
      startTime: '09:00',
      endTime: '17:00',
      reason: 'Family matter',
      type: 'daily',
    });

    expect(createLeave.status).toBe(201);
    const leaveId = createLeave.body.id;

    const approve = await api('PATCH', `/api/requests/leave/${leaveId}`, adminToken, { status: 'approved' });
    expect(approve.status).toBe(200);

    const rows = await db('notifications').orderBy('created_at', 'desc');
    expect(rows.length).toBeGreaterThanOrEqual(3);

    const requesterNotification = rows.find((n: any) => String(n.target_user_id) === String(CSR_ID));
    expect(requesterNotification).toBeTruthy();
    expect(String(requesterNotification.author_id)).toBe(String(ADMIN_ID));
    expect(requesterNotification.content).toContain('Admin One');
    expect(requesterNotification.content).toContain('зөвшөөрлөө');

    const adminRows = rows.filter((n: any) => String(n.target_user_id) === String(ADMIN_ID) || String(n.target_user_id) === String(SECOND_ADMIN_ID));
    expect(adminRows.length).toBeGreaterThanOrEqual(2);
    expect(adminRows.some((n: any) => n.content.includes('Admin One') && n.content.includes('CSR One'))).toBe(true);

    const csrCopies = rows.filter((n: any) => String(n.target_user_id) === String(OTHER_CSR_ID));
    expect(csrCopies.length).toBe(0);
  });
});
