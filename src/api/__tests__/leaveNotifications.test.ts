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
const SLOT_ID = '55555555-5555-4555-8555-555555555555';
const BOOKING_ID = '66666666-6666-4666-8666-666666666666';

// Far enough out that the eight-hours-before-the-shift rule is satisfied no
// matter what time of day the suite runs.
const SHIFT_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
    t.uuid('slot_booking_id');
    t.timestamps(true, true);
  });

  // Leave is only ever requested against a shift the CSR has booked, so
  // these two tables are now part of the leave flow.
  await db.schema.createTable('work_slots', (t: any) => {
    t.uuid('id').primary();
    t.date('date').notNullable();
    t.time('start_time').notNullable();
    t.time('end_time').notNullable();
    t.float('duration').defaultTo(0);
    t.integer('capacity').defaultTo(5);
    t.string('segment').defaultTo('All');
    t.string('employment_type').defaultTo('Full Time');
    t.string('location').defaultTo('Ulaanbaatar');
    t.boolean('is_rest').defaultTo(false);
    t.timestamps(true, true);
  });

  await db.schema.createTable('slot_bookings', (t: any) => {
    t.uuid('id').primary();
    t.uuid('slot_id');
    t.uuid('user_id');
    t.string('status').defaultTo('confirmed');
    t.string('user_name');
    t.string('user_code');
    t.dateTime('booked_at');
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
  await db('slot_bookings').del();
  await db('work_slots').del();

  await db('work_slots').insert({
    id: SLOT_ID, date: SHIFT_DATE, start_time: '09:00:00', end_time: '17:00:00',
    duration: 8, capacity: 5, segment: 'VIP', employment_type: 'Full Time', location: 'Ulaanbaatar',
  });
  await db('slot_bookings').insert({
    id: BOOKING_ID, slot_id: SLOT_ID, user_id: CSR_ID, status: 'confirmed', user_name: 'CSR One',
  });
});

describe('leave request notifications', () => {
  it('sends one exact notification to the requester and admin copies that identify the acting admin and requester', async () => {
    const createLeave = await api('POST', '/api/requests/leave', csrToken, {
      slotBookingId: BOOKING_ID,
      reason: 'Family matter',
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

  it('shows the admin rejection reason in the requester notification', async () => {
    const createLeave = await api('POST', '/api/requests/leave', csrToken, {
      slotBookingId: BOOKING_ID,
      reason: 'Family matter',
    });

    expect(createLeave.status).toBe(201);
    const leaveId = createLeave.body.id;
    const rejectionReason = 'Ээлжийн зохицуулалт хийх боломжгүй байна';

    const reject = await api('PATCH', `/api/requests/leave/${leaveId}`, adminToken, {
      status: 'rejected',
      comment: `  ${rejectionReason}  `,
    });

    expect(reject.status).toBe(200);
    expect(await db('leave_requests').where({ id: leaveId }).first()).toMatchObject({
      status: 'rejected',
      comment: rejectionReason,
    });

    const notifications = await api('GET', '/api/broadcasts/notifications', csrToken);
    expect(notifications.status).toBe(200);
    const requesterNotification = notifications.body.find((n: any) => n.type === 'leave_decision');
    expect(requesterNotification).toBeTruthy();
    expect(requesterNotification.content).toContain('татгалзлаа');
    expect(requesterNotification.content).toContain(`Шалтгаан: ${rejectionReason}`);
  });

  it('refuses leave that is not tied to a booked shift', async () => {
    const created = await api('POST', '/api/requests/leave', csrToken, {
      date: SHIFT_DATE,
      endDate: SHIFT_DATE,
      startTime: '09:00',
      endTime: '17:00',
      reason: 'A day I was never rostered for',
      type: 'daily',
    });

    expect(created.status).toBe(400);
    expect(await db('leave_requests').count({ c: '*' }).first()).toMatchObject({ c: 0 });
  });

  it('refuses a booking that belongs to someone else', async () => {
    const otherCsrToken = (await import('jsonwebtoken')).default.sign(
      { id: OTHER_CSR_ID, email: 'othercsr@test.mn', role: 'csr', name: 'Other CSR' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' },
    );

    const created = await api('POST', '/api/requests/leave', otherCsrToken, {
      slotBookingId: BOOKING_ID,
      reason: 'Not my shift',
    });

    expect(created.status).toBe(403);
  });

  it('records the whole shift as shift_leave and part of it as hourly', async () => {
    const whole = await api('POST', '/api/requests/leave', csrToken, {
      slotBookingId: BOOKING_ID,
      reason: 'Out all day',
    });
    expect(whole.status).toBe(201);
    expect(await db('leave_requests').where({ id: whole.body.id }).first()).toMatchObject({
      type: 'shift_leave', start_time: '09:00:00', end_time: '17:00:00',
    });

    await db('leave_requests').del();

    const partial = await api('POST', '/api/requests/leave', csrToken, {
      slotBookingId: BOOKING_ID,
      startTime: '13:00',
      endTime: '15:00',
      reason: 'Appointment',
    });
    expect(partial.status).toBe(201);
    expect(await db('leave_requests').where({ id: partial.body.id }).first()).toMatchObject({
      type: 'hourly', start_time: '13:00:00', end_time: '15:00:00',
    });
  });

  it('keeps the requested hours inside the shift, and rejects an overlapping second window', async () => {
    const outside = await api('POST', '/api/requests/leave', csrToken, {
      slotBookingId: BOOKING_ID,
      startTime: '18:00',
      endTime: '19:00',
      reason: 'After the shift ends',
    });
    expect(outside.status).toBe(400);

    const first = await api('POST', '/api/requests/leave', csrToken, {
      slotBookingId: BOOKING_ID,
      startTime: '10:00',
      endTime: '12:00',
      reason: 'Morning',
    });
    expect(first.status).toBe(201);

    const overlapping = await api('POST', '/api/requests/leave', csrToken, {
      slotBookingId: BOOKING_ID,
      startTime: '11:00',
      endTime: '13:00',
      reason: 'Overlaps the morning',
    });
    expect(overlapping.status).toBe(409);

    // A second window on the same shift is fine as long as it does not
    // overlap the first.
    const later = await api('POST', '/api/requests/leave', csrToken, {
      slotBookingId: BOOKING_ID,
      startTime: '14:00',
      endTime: '16:00',
      reason: 'Afternoon',
    });
    expect(later.status).toBe(201);
  });

  it('lets the requester edit and withdraw a request nobody has answered yet', async () => {
    const created = await api('POST', '/api/requests/leave', csrToken, {
      slotBookingId: BOOKING_ID,
      startTime: '10:00',
      endTime: '11:00',
      reason: 'Wrong hours',
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const edited = await api('PUT', `/api/requests/leave/${id}`, csrToken, {
      slotBookingId: BOOKING_ID,
      startTime: '14:00',
      endTime: '16:00',
      reason: 'Corrected hours',
    });
    expect(edited.status).toBe(200);
    expect(await db('leave_requests').where({ id }).first()).toMatchObject({
      start_time: '14:00:00', end_time: '16:00:00', reason: 'Corrected hours', type: 'hourly',
    });

    const removed = await api('DELETE', `/api/requests/leave/${id}`, csrToken);
    expect(removed.status).toBe(200);
    expect(await db('leave_requests').where({ id }).first()).toBeFalsy();
    // The admins' pending alerts pointed at a request that no longer exists.
    expect(await db('notifications').where({ related_entity_id: id }).first()).toBeFalsy();
  });

  it('will not let a decided request be edited or withdrawn, nor touched by another CSR', async () => {
    const created = await api('POST', '/api/requests/leave', csrToken, {
      slotBookingId: BOOKING_ID,
      reason: 'Whole shift',
    });
    const id = created.body.id;

    const otherCsrToken = (await import('jsonwebtoken')).default.sign(
      { id: OTHER_CSR_ID, email: 'othercsr@test.mn', role: 'csr', name: 'Other CSR' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' },
    );
    expect((await api('DELETE', `/api/requests/leave/${id}`, otherCsrToken)).status).toBe(403);
    expect((await api('PUT', `/api/requests/leave/${id}`, otherCsrToken, { reason: 'Not mine' })).status).toBe(403);

    expect((await api('PATCH', `/api/requests/leave/${id}`, adminToken, { status: 'approved' })).status).toBe(200);

    expect((await api('PUT', `/api/requests/leave/${id}`, csrToken, { reason: 'Too late' })).status).toBe(409);
    expect((await api('DELETE', `/api/requests/leave/${id}`, csrToken)).status).toBe(409);
    expect(await db('leave_requests').where({ id }).first()).toBeTruthy();
  });
});
