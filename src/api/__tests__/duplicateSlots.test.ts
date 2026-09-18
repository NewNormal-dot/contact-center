import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

// Must be set BEFORE anything imports src/database/db.
const TEMP_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dupes-')), 'test.sqlite');
process.env.NODE_ENV = 'development';
process.env.SQLITE_FILE = TEMP_DB;
process.env.JWT_SECRET = 'test-secret-for-vitest-only';

let db: any;
let server: Server;
let baseUrl: string;
let superToken: string;
let csrToken: string;

const SUPER_ID = '99999999-9999-4999-8999-999999999999';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

const SLOT_A = 'aaaa0000-0000-4000-8000-000000000001';
const SLOT_B = 'bbbb0000-0000-4000-8000-000000000002';
const SLOT_C = 'cccc0000-0000-4000-8000-000000000003';
const SLOT_OTHER = '0000aaaa-0000-4000-8000-00000000000f';

const IDENTITY = {
  date: '2026-09-03',
  start_time: '09:00:00',
  end_time: '18:00:00',
  duration: 9,
  segment: 'Broadband',
  employment_type: 'Part Time',
  location: 'Ulaanbaatar',
  is_rest: 0,
};

async function createSchema() {
  await db.schema.createTable('users', (t: any) => {
    t.uuid('id').primary();
    t.string('email').unique().notNullable();
    t.string('password_hash').notNullable();
    t.string('name').notNullable();
    t.string('role').defaultTo('csr');
    t.string('status').defaultTo('active');
    t.dateTime('sessions_valid_from');
    t.timestamps(true, true);
  });

  // NOT unique here: this suite exercises the state the migration leaves
  // behind when it finds duplicates and therefore cannot make it unique.
  await db.schema.createTable('work_slots', (t: any) => {
    t.uuid('id').primary();
    t.date('date').notNullable();
    t.time('start_time').notNullable();
    t.time('end_time').notNullable();
    t.float('duration').notNullable();
    t.integer('capacity').notNullable();
    t.dateTime('booking_deadline');
    t.dateTime('booking_open_at');
    t.boolean('booking_is_open').notNullable().defaultTo(false);
    t.string('segment').notNullable().defaultTo('All');
    t.string('employment_type').notNullable().defaultTo('Full Time');
    t.string('location').notNullable().defaultTo('Ulaanbaatar');
    t.boolean('is_rest').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  await db.schema.createTable('slot_bookings', (t: any) => {
    t.string('id').primary();
    t.uuid('slot_id');
    t.uuid('user_id');
    t.dateTime('booked_at');
    t.string('status').defaultTo('confirmed');
    // The constraint that makes merging non-trivial: a person booked onto
    // BOTH duplicates cannot simply be moved across.
    t.unique(['slot_id', 'user_id']);
  });

  await db.schema.createTable('trade_requests', (t: any) => {
    t.string('id').primary();
    t.uuid('sender_id');
    t.uuid('receiver_id');
    t.uuid('sender_slot_id');
    t.uuid('receiver_slot_id');
    // Mirrors the real enum. 'cancelled' is NOT a member - an earlier version
    // of the merge used it and aborted the whole transaction on a CHECK
    // constraint violation.
    t.enum('status', ['pending', 'accepted', 'approved', 'rejected']).defaultTo('pending');
    t.timestamps(true, true);
  });

  await db.schema.createTable('audit_logs', (t: any) => {
    t.uuid('id').primary();
    t.uuid('user_id');
    t.string('action').notNullable();
    t.string('entity_type').notNullable();
    t.uuid('entity_id');
    t.text('details');
    t.string('ip_address');
    t.timestamps(true, true);
  });
}

async function seed() {
  await db('work_slots').insert([
    { id: SLOT_A, ...IDENTITY, capacity: 2 },
    { id: SLOT_B, ...IDENTITY, capacity: 5 },
    { id: SLOT_C, ...IDENTITY, capacity: 1 },
    { id: SLOT_OTHER, ...IDENTITY, date: '2026-09-10', capacity: 3 },
  ]);

  await db('slot_bookings').insert([
    // U1 is on BOTH A and B - the UNIQUE(slot_id, user_id) clash.
    { id: 'b1', slot_id: SLOT_A, user_id: U1, status: 'cancelled' },
    { id: 'b2', slot_id: SLOT_B, user_id: U1, status: 'confirmed' },
    { id: 'b3', slot_id: SLOT_B, user_id: U2, status: 'confirmed' },
  ]);

  await db('trade_requests').insert([
    // Both sides are duplicates of one shift: collapses on merge.
    { id: 't1', sender_id: U2, receiver_id: U1, sender_slot_id: SLOT_C, receiver_slot_id: SLOT_A, status: 'pending' },
    // Points at a genuinely different shift: must survive untouched.
    { id: 't2', sender_id: U1, receiver_id: U2, sender_slot_id: SLOT_A, receiver_slot_id: SLOT_OTHER, status: 'pending' },
  ]);
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
  const express = (await import('express')).default;
  const jwt = (await import('jsonwebtoken')).default;
  db = (await import('../../database/db')).default;

  await createSchema();
  await db('users').insert([
    { id: SUPER_ID, email: 'sa@test.mn', password_hash: 'x', name: 'SA', role: 'superadmin', status: 'active' },
    { id: U1, email: 'u1@test.mn', password_hash: 'x', name: 'U1', role: 'csr', status: 'active' },
    { id: U2, email: 'u2@test.mn', password_hash: 'x', name: 'U2', role: 'csr', status: 'active' },
  ]);

  const adminRoutes = (await import('../admin')).default;
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/admin', adminRoutes);

  superToken = jwt.sign({ id: SUPER_ID, email: 'sa@test.mn', role: 'superadmin', name: 'SA' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
  csrToken = jwt.sign({ id: U1, email: 'u1@test.mn', role: 'csr', name: 'U1' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

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
  await db('trade_requests').del();
  await db('slot_bookings').del();
  await db('work_slots').del();
  await db('audit_logs').del();

  // A successful apply PROMOTES the index to unique - that is the point of
  // it - which then makes this suite's duplicate fixtures un-insertable. Put
  // the table back into the state the migration leaves when it finds
  // duplicates, so every test starts from the same place.
  await db.raw(`drop index if exists uq_work_slots_identity`).catch(() => undefined);

  await seed();
});

describe('GET /api/admin/duplicate-slots', () => {
  it('finds the group and says who is actually booked on each row', async () => {
    const res = await api('GET', '/api/admin/duplicate-slots', superToken);
    expect(res.status).toBe(200);
    expect(res.body.groupCount).toBe(1);
    expect(res.body.totalRows).toBe(3);
    expect(res.body.indexIsUnique).toBe(false);

    const byId = Object.fromEntries(res.body.groups[0].rows.map((r: any) => [r.id, r]));
    expect(byId[SLOT_B].confirmedBookings).toBe(2);
    expect(byId[SLOT_A].confirmedBookings).toBe(0);
    expect(byId[SLOT_A].otherBookings).toBe(1); // the cancelled one
    expect(byId[SLOT_C].confirmedBookings).toBe(0);
  });

  it('describes the shift in a form a human can act on', async () => {
    // The migration's own message interpolated the raw driver values, so it
    // read "Thu Sep 03 2026 00:00:00 GMT+0000 ... Thu Jan 01 1970 09:00:00
    // GMT+0000-..." - correct and useless, in the one message whose whole
    // job is telling someone which rows to fix.
    const res = await api('GET', '/api/admin/duplicate-slots', superToken);
    expect(res.body.groups[0].description).toBe('2026-09-03 09:00-18:00 Broadband/Part Time/Ulaanbaatar');
  });

  it('is superadmin-only', async () => {
    expect((await api('GET', '/api/admin/duplicate-slots', csrToken)).status).toBe(403);
  });
});

describe('POST /api/admin/merge-duplicate-slots', () => {
  it('previews without touching anything', async () => {
    const res = await api('POST', '/api/admin/merge-duplicate-slots', superToken, {});
    expect(res.body.applied).toBe(false);
    expect(res.body.plan[0].keep).toBe(SLOT_B); // most confirmed bookings
    expect(res.body.plan[0].remove.sort()).toEqual([SLOT_A, SLOT_C].sort());
    expect(res.body.plan[0].capacity).toBe(5); // the largest, so nobody loses a seat

    expect(await db('work_slots')).toHaveLength(4);
    expect(await db('slot_bookings')).toHaveLength(3);
    expect((await db('trade_requests').select('status')).every((t: any) => t.status === 'pending')).toBe(true);
  });

  it('counts the collapsing trade in the preview, not just on apply', async () => {
    // Detecting it as sender_slot_id === receiver_slot_id only works AFTER
    // repointing, so on a dry run that test matches nothing and the preview
    // reported 0 - telling the operator this endpoint does nothing it does.
    const res = await api('POST', '/api/admin/merge-duplicate-slots', superToken, {});
    expect(res.body.plan[0].degenerateTradesClosed).toBe(1);
  });

  it('merges onto one row, keeping every confirmed booking', async () => {
    const res = await api('POST', '/api/admin/merge-duplicate-slots', superToken, { apply: true });
    expect(res.body.applied).toBe(true);

    const remaining = await db('work_slots').where(IDENTITY);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(SLOT_B);
    expect(Number(remaining[0].capacity)).toBe(5);

    const bookings = await db('slot_bookings').where({ slot_id: SLOT_B }).orderBy('id');
    expect(bookings.map((b: any) => b.user_id).sort()).toEqual([U1, U2].sort());
    expect(bookings.every((b: any) => b.status === 'confirmed')).toBe(true);
  });

  it('drops the losing row of a person booked on both, rather than failing', async () => {
    // slot_bookings carries UNIQUE(slot_id, user_id): U1 cannot be moved onto
    // a slot they are already on.
    await api('POST', '/api/admin/merge-duplicate-slots', superToken, { apply: true });
    const u1 = await db('slot_bookings').where({ user_id: U1 });
    expect(u1).toHaveLength(1);
    expect(u1[0].status).toBe('confirmed');
  });

  it('repoints a live trade and rejects one whose two sides became one shift', async () => {
    await api('POST', '/api/admin/merge-duplicate-slots', superToken, { apply: true });

    const t1 = await db('trade_requests').where({ id: 't1' }).first();
    expect(t1.status).toBe('rejected'); // 'cancelled' is not in the enum

    const t2 = await db('trade_requests').where({ id: 't2' }).first();
    expect(t2.status).toBe('pending');
    expect(t2.sender_slot_id).toBe(SLOT_B);
    expect(t2.receiver_slot_id).toBe(SLOT_OTHER); // the real other shift, untouched
  });

  it('leaves no duplicates behind and records what it did', async () => {
    await api('POST', '/api/admin/merge-duplicate-slots', superToken, { apply: true });

    const after = await api('GET', '/api/admin/duplicate-slots', superToken);
    expect(after.body.groupCount).toBe(0);

    const entry = await db('audit_logs').where({ action: 'MERGE_DUPLICATE_SLOTS' }).first();
    expect(entry).toBeTruthy();
    expect(entry.details).toContain('1 group(s) merged');
    expect(entry.ip_address).toBeTruthy();
  });

  it('is superadmin-only', async () => {
    expect((await api('POST', '/api/admin/merge-duplicate-slots', csrToken, {})).status).toBe(403);
  });
});
