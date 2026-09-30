import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';

// Must be set BEFORE anything imports src/database/db, which builds the knex
// instance from knexfile at module-evaluation time.
const TEMP_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-')), 'test.sqlite');
process.env.NODE_ENV = 'development';
process.env.SQLITE_FILE = TEMP_DB;
process.env.JWT_SECRET = 'test-secret-for-vitest-only';

let db: any;
let server: Server;
let baseUrl: string;
let csrToken: string;
let adminToken: string;

const CSR_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const SLOT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SLOT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Signs a JWT for a test user, matching the shape auth middleware expects. */
function tokenFor(user: { id: string; email: string; role: string; name: string }) {
  return jwt.sign(user, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

/**
 * Builds just the tables these handlers touch.
 *
 * Deliberately NOT knex.migrate.latest(): the migration files import each
 * other with explicit .ts specifiers, which knex's own loader cannot resolve
 * under the test runner. What matters for these tests is that the real
 * constraint is present - UNIQUE(slot_id, user_id) on slot_bookings is the
 * whole reason the cancel/re-book bug existed.
 */
async function createSchema() {
  await db.schema.createTable('users', (t: any) => {
    t.uuid('id').primary();
    t.string('email').unique().notNullable();
    t.string('password_hash').notNullable();
    t.string('name').notNullable();
    t.string('role').defaultTo('csr');
    t.string('status').defaultTo('active');
    t.string('photo_url');
    t.string('code');
    t.string('segment');
    t.string('employment_type').defaultTo('Full Time');
    t.string('location');
    t.string('supervisor_name');
    t.dateTime('sessions_valid_from');
    t.timestamps(true, true);
  });

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
    t.text('booking_waves');
    // The other constraint these tests exist to pin down. work_slots had no
    // unique key on a shift's identity, so "the same shift must not exist
    // twice" rested entirely on application code that reads, decides, then
    // writes - with a window in between.
    t.unique(['date', 'start_time', 'end_time', 'segment', 'employment_type', 'location', 'is_rest'], { indexName: 'uq_work_slots_identity' });
    t.timestamps(true, true);
  });

  await db.schema.createTable('slot_bookings', (t: any) => {
    t.uuid('id').primary();
    t.uuid('slot_id').references('id').inTable('work_slots').onDelete('CASCADE');
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.dateTime('booked_at');
    t.string('status').defaultTo('confirmed');
    t.string('user_name');
    t.string('user_code');
    t.string('booking_wave_id', 64);
    // 2026-09-29 trade rewrite: a shift obtained via an earlier trade may
    // never be traded away again - see bookingAcquiredViaTrade in trades.ts.
    t.boolean('acquired_via_trade').notNullable().defaultTo(false);
    // The constraint this whole file exists to pin down.
    t.unique(['slot_id', 'user_id']);
  });

  await db.schema.createTable('trade_requests', (t: any) => {
    t.uuid('id').primary();
    t.uuid('sender_id');
    t.uuid('receiver_id');
    t.uuid('sender_slot_id');
    t.uuid('receiver_slot_id');
    t.uuid('sender_next_slot_id').references('id').inTable('work_slots');
    t.uuid('receiver_next_slot_id').references('id').inTable('work_slots');
    t.string('status').defaultTo('pending');
    t.uuid('approved_by');
    t.dateTime('receiver_responded_at');
    t.dateTime('admin_decided_at');
    // 2026-09-29 trade rewrite columns - see
    // 20260929000000_add_trade_v2_fields.ts.
    t.dateTime('expires_at');
    t.string('sender_new_shift_summary', 191);
    t.string('receiver_new_shift_summary', 191);
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

  await db.schema.createTable('shift_rule_settings', (t: any) => {
    t.string('id', 191).primary();
    t.string('rule_type', 64).notNullable();
    t.string('month_key', 7);
    t.string('segment', 100).notNullable();
    t.string('employment_type', 20).notNullable();
    t.string('location', 20).notNullable().defaultTo('Ulaanbaatar');
    t.text('value_text').notNullable();
    t.timestamps(true, true);
  });

  await db.schema.createTable('notifications', (t: any) => {
    t.uuid('id').primary();
    t.string('title').notNullable();
    t.text('content').notNullable();
    t.string('image_url');
    t.dateTime('deadline');
    t.uuid('author_id');
    t.string('type').notNullable().defaultTo('general');
    t.uuid('target_user_id');
    t.string('related_entity_type');
    t.string('related_entity_id');
    t.timestamps(true, true);
  });

  // Removing a shift now clears the pending leave requests raised against
  // the bookings on it, so the reconciliation path touches this table too.
  await db.schema.createTable('leave_requests', (t: any) => {
    t.uuid('id').primary();
    t.uuid('user_id');
    t.date('date').notNullable();
    t.date('end_date');
    t.time('start_time');
    t.time('end_time');
    t.string('reason');
    t.string('type').defaultTo('hourly');
    t.string('status').defaultTo('pending');
    t.uuid('slot_booking_id');
    t.timestamps(true, true);
  });
}

/** A future date, so booking windows and past-date guards behave normally. */
function futureDate(daysAhead = 7) {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

async function seed() {
  await db('users').insert([
    {
      id: CSR_ID, email: 'csr@test.mn', password_hash: 'x', name: 'Test CSR',
      role: 'csr', status: 'active', segment: 'Postpaid',
      employment_type: 'Full Time', location: 'Ulaanbaatar', code: 'C001',
    },
    {
      id: ADMIN_ID, email: 'admin@test.mn', password_hash: 'x', name: 'Test Admin',
      role: 'admin', status: 'active', segment: 'Supervisor',
      employment_type: 'Full Time', location: 'Ulaanbaatar',
    },
  ]);

  const openWindow = {
    booking_is_open: 1,
    booking_open_at: new Date(Date.now() - 3_600_000),
    booking_deadline: new Date(Date.now() + 7 * 86_400_000),
    segment: 'Postpaid',
    employment_type: 'Full Time',
    location: 'Ulaanbaatar',
    is_rest: 0,
  };

  await db('work_slots').insert([
    { id: SLOT_A, date: futureDate(), start_time: '09:00:00', end_time: '18:00:00', duration: 9, capacity: 2, ...openWindow },
    { id: SLOT_B, date: futureDate(1), start_time: '10:00:00', end_time: '19:00:00', duration: 9, capacity: 2, ...openWindow },
  ]);
}

async function api(method: string, route: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const express = (await import('express')).default;
  db = (await import('../../database/db')).default;

  await createSchema();
  await seed();

  const slotRoutes = (await import('../slots')).default;
  const tradeRoutes = (await import('../trades')).default;
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/slots', slotRoutes);
  app.use('/api/trades', tradeRoutes);

  csrToken = tokenFor({ id: CSR_ID, email: 'csr@test.mn', role: 'csr', name: 'Test CSR' });
  adminToken = tokenFor({ id: ADMIN_ID, email: 'admin@test.mn', role: 'admin', name: 'Test Admin' });

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

describe('POST /api/slots/book - cancel then re-book the same shift', () => {
  it('lets a CSR retake a shift they cancelled, instead of 500-ing', async () => {
    // THE BUG: cancelling is a soft delete (the row stays as 'cancelled'),
    // and slot_bookings carries UNIQUE(slot_id, user_id). Re-booking
    // INSERTed a second row for the same pair, the constraint rejected it,
    // and the handler's catch turned that into a bare 500
    // "Захиалга хийхэд алдаа гарлаа". A CSR could never retake a shift they
    // had cancelled - an entirely ordinary sequence.
    const first = await api('POST', '/api/slots/book', csrToken, { slotId: SLOT_A });
    expect(first.status).toBe(201);

    const cancelled = await api('POST', `/api/slots/${SLOT_A}/cancel`, csrToken, { slotId: SLOT_A });
    expect(cancelled.status).toBe(200);

    const again = await api('POST', '/api/slots/book', csrToken, { slotId: SLOT_A });
    expect(again.status).toBe(201);

    // Exactly one row for the pair, and it is confirmed.
    const rows = await db('slot_bookings').where({ slot_id: SLOT_A, user_id: CSR_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('confirmed');
  });

  it('takes an undecided Чөлөө with the booking it was raised against', async () => {
    // Leave is only ever requested against a confirmed booking. Cancelling
    // that booking used to leave the request behind, so an admin still saw -
    // and could approve - leave for a shift the CSR no longer works.
    const booked = await api('POST', '/api/slots/book', csrToken, { slotId: SLOT_A });
    expect([200, 201]).toContain(booked.status);
    const bookingRow = await db('slot_bookings').where({ slot_id: SLOT_A, user_id: CSR_ID, status: 'confirmed' }).first();
    expect(bookingRow).toBeTruthy();

    await db('leave_requests').insert([
      {
        id: 'aaaa1111-1111-4111-8111-111111111111',
        user_id: CSR_ID, date: futureDate(), start_time: '09:00:00', end_time: '18:00:00',
        reason: 'Undecided', status: 'pending', slot_booking_id: bookingRow.id,
      },
      {
        id: 'bbbb2222-2222-4222-8222-222222222222',
        user_id: CSR_ID, date: futureDate(), start_time: '09:00:00', end_time: '18:00:00',
        reason: 'Already decided', status: 'approved', slot_booking_id: bookingRow.id,
      },
    ]);
    await db('notifications').insert({
      id: 'cccc3333-3333-4333-8333-333333333333',
      title: 'Чөлөөний хүсэлт', content: 'pending alert', type: 'leave_request',
      related_entity_type: 'leave_request', related_entity_id: 'aaaa1111-1111-4111-8111-111111111111',
    });

    const cancelled = await api('POST', `/api/slots/${SLOT_A}/cancel`, csrToken, { slotId: SLOT_A });
    expect(cancelled.status).toBe(200);

    // The undecided request and its admin alert are gone...
    expect(await db('leave_requests').where({ status: 'pending' }).first()).toBeFalsy();
    expect(await db('notifications').where({ id: 'cccc3333-3333-4333-8333-333333333333' }).first()).toBeFalsy();
    // ...while the decided one stays as history.
    expect(await db('leave_requests').where({ status: 'approved' }).first()).toBeTruthy();

    // Leave the fixture as this block found it: the next case expects a
    // confirmed booking on this date.
    await db('leave_requests').del();
    expect([200, 201]).toContain((await api('POST', '/api/slots/book', csrToken, { slotId: SLOT_A })).status);
  });

  it('still refuses two different shifts on the same day', async () => {
    const sameDaySlot = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await db('work_slots').insert({
      id: sameDaySlot, date: futureDate(), start_time: '12:00:00', end_time: '20:00:00',
      duration: 8, capacity: 2, booking_is_open: 1,
      booking_open_at: new Date(Date.now() - 3_600_000),
      booking_deadline: new Date(Date.now() + 7 * 86_400_000),
      segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 0,
    });

    const clash = await api('POST', '/api/slots/book', csrToken, { slotId: sameDaySlot });
    expect(clash.status).toBe(400);
    expect(clash.body.error).toContain('аль хэдийн захиалга');
  });

  it('still refuses a shift from another segment', async () => {
    const otherSegment = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await db('work_slots').insert({
      id: otherSegment, date: futureDate(3), start_time: '09:00:00', end_time: '18:00:00',
      duration: 9, capacity: 2, booking_is_open: 1,
      booking_open_at: new Date(Date.now() - 3_600_000),
      booking_deadline: new Date(Date.now() + 7 * 86_400_000),
      segment: 'Prepaid', employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 0,
    });

    const rejected = await api('POST', '/api/slots/book', csrToken, { slotId: otherSegment });
    expect(rejected.status).toBe(403);
  });

  it('still refuses to exceed capacity', async () => {
    const full = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await db('work_slots').insert({
      id: full, date: futureDate(4), start_time: '09:00:00', end_time: '18:00:00',
      duration: 9, capacity: 1, booking_is_open: 1,
      booking_open_at: new Date(Date.now() - 3_600_000),
      booking_deadline: new Date(Date.now() + 7 * 86_400_000),
      segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 0,
    });
    await db('slot_bookings').insert({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      slot_id: full, user_id: ADMIN_ID, status: 'confirmed', booked_at: new Date(),
    });

    const rejected = await api('POST', '/api/slots/book', csrToken, { slotId: full });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain('Орон тоо');
  });
});

// ---------------------------------------------------------------------------
// 2026-09-29 trade rewrite. Rewritten to match the current rules in
// src/api/trades.ts (see FINAL_APPLY_INSTRUCTIONS.md's "Summary of
// behavioural changes" for the full list). In particular, compared to the
// trade logic this file originally tested:
//   - a bare rest/rest swap is now REJECTED (it used to be allowed) -
//     swapping two days off for each other changes nobody's schedule;
//   - a work/work swap is now blocked when the two shifts share EITHER a
//     start time OR an end time (previously only a shared start time was
//     checked);
//   - the duration-preserving swap itself was buggy (chaining the second
//     move off the first move's own result) and is now anchored correctly
//     to each shift's ORIGINAL far edge - this suite's first test pins
//     down the exact numbers so a regression here is caught immediately;
//   - trading now requires the shift's booking window to be CLOSED, and at
//     least 3 hours to remain before it starts;
//   - a shift obtained via an earlier trade can never be traded away again;
//   - only one PENDING outgoing request per sender at a time is allowed.
// ---------------------------------------------------------------------------
describe('POST /api/trades - trade validation rules', () => {
  it("preserves each side's duration when swapping two closed shifts with different start and end times", async () => {
    const receiverId = 'a1000000-0000-4000-8000-000000000001';
    const senderSlotId = 'a1000000-0000-4000-8000-000000000002';
    const receiverSlotId = 'a1000000-0000-4000-8000-000000000003';
    const day = futureDate(10);

    await db('users').insert({
      id: receiverId, email: 'swap-receiver@test.mn', password_hash: 'x', name: 'Swap Receiver',
      role: 'csr', status: 'active', segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', code: 'C010',
    });

    // Booking already CLOSED for both shifts - required before either can
    // be traded (see whyWorkSlotNotTradeable in trades.ts).
    const closedWindow = {
      booking_is_open: 0,
      booking_open_at: null,
      booking_deadline: new Date(Date.now() - 3_600_000),
      segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 0,
    };

    // 09:00-15:00 (6h) <-> 13:00-20:00 (7h). Confirmed correct result:
    // the earlier shift's holder moves to 14:00-20:00 (keeps 6h, ends where
    // the other shift originally ended); the later shift's holder moves to
    // 09:00-16:00 (keeps 7h, starts where the other shift originally started).
    await db('work_slots').insert([
      { id: senderSlotId, date: day, start_time: '09:00:00', end_time: '15:00:00', duration: 6, capacity: 2, ...closedWindow },
      { id: receiverSlotId, date: day, start_time: '13:00:00', end_time: '20:00:00', duration: 7, capacity: 2, ...closedWindow },
    ]);

    const senderBookingId = 'a1000000-0000-4000-8000-0000000000a1';
    const receiverBookingId = 'a1000000-0000-4000-8000-0000000000a2';
    await db('slot_bookings').insert([
      { id: senderBookingId, slot_id: senderSlotId, user_id: CSR_ID, status: 'confirmed', booked_at: new Date() },
      { id: receiverBookingId, slot_id: receiverSlotId, user_id: receiverId, status: 'confirmed', booked_at: new Date() },
    ]);

    const created = await api('POST', '/api/trades', csrToken, {
      receiver_id: receiverId,
      sender_slot_id: senderSlotId,
      receiver_slot_id: receiverSlotId,
    });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();

    const receiverToken = tokenFor({ id: receiverId, email: 'swap-receiver@test.mn', role: 'csr', name: 'Swap Receiver' });
    const accepted = await api('PATCH', `/api/trades/${created.body.id}/respond`, receiverToken, { status: 'accepted' });
    expect(accepted.status).toBe(200);

    const senderBooking = await db('slot_bookings').where({ id: senderBookingId }).first();
    const receiverBooking = await db('slot_bookings').where({ id: receiverBookingId }).first();
    const senderNewSlot = await db('work_slots').where({ id: senderBooking.slot_id }).first();
    const receiverNewSlot = await db('work_slots').where({ id: receiverBooking.slot_id }).first();

    expect(String(senderNewSlot.start_time)).toContain('14:00');
    expect(String(senderNewSlot.end_time)).toContain('20:00');
    expect(String(receiverNewSlot.start_time)).toContain('09:00');
    expect(String(receiverNewSlot.end_time)).toContain('16:00');

    // Both bookings this trade produced are flagged, so neither can be
    // traded away again.
    expect(Boolean(senderBooking.acquired_via_trade)).toBe(true);
    expect(Boolean(receiverBooking.acquired_via_trade)).toBe(true);

    // History snapshots are recorded once the trade is approved.
    const tradeRow = await db('trade_requests').where({ id: created.body.id }).first();
    expect(String(tradeRow.sender_new_shift_summary)).toContain('14:00');
    expect(String(tradeRow.receiver_new_shift_summary)).toContain('09:00');
  });

  it('rejects a work/work swap when both shifts share a start time', async () => {
    const receiverId = 'a2000000-0000-4000-8000-000000000001';
    const senderSlotId = 'a2000000-0000-4000-8000-000000000002';
    const receiverSlotId = 'a2000000-0000-4000-8000-000000000003';
    const day = futureDate(11);

    await db('users').insert({
      id: receiverId, email: 'samestart-receiver@test.mn', password_hash: 'x', name: 'SameStart Receiver',
      role: 'csr', status: 'active', segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', code: 'C011',
    });

    const closedWindow = {
      booking_is_open: 0, booking_open_at: null, booking_deadline: new Date(Date.now() - 3_600_000),
      segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 0,
    };
    await db('work_slots').insert([
      { id: senderSlotId, date: day, start_time: '09:00:00', end_time: '14:00:00', duration: 5, capacity: 2, ...closedWindow },
      { id: receiverSlotId, date: day, start_time: '09:00:00', end_time: '18:00:00', duration: 9, capacity: 2, ...closedWindow },
    ]);
    await db('slot_bookings').insert([
      { id: 'a2000000-0000-4000-8000-0000000000a1', slot_id: senderSlotId, user_id: CSR_ID, status: 'confirmed', booked_at: new Date() },
      { id: 'a2000000-0000-4000-8000-0000000000a2', slot_id: receiverSlotId, user_id: receiverId, status: 'confirmed', booked_at: new Date() },
    ]);

    const rejected = await api('POST', '/api/trades', csrToken, {
      receiver_id: receiverId, sender_slot_id: senderSlotId, receiver_slot_id: receiverSlotId,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain('Ижил эхлэх');
  });

  it('rejects a work/work swap when both shifts share an end time', async () => {
    const receiverId = 'a3000000-0000-4000-8000-000000000001';
    const senderSlotId = 'a3000000-0000-4000-8000-000000000002';
    const receiverSlotId = 'a3000000-0000-4000-8000-000000000003';
    const day = futureDate(12);

    await db('users').insert({
      id: receiverId, email: 'sameend-receiver@test.mn', password_hash: 'x', name: 'SameEnd Receiver',
      role: 'csr', status: 'active', segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', code: 'C012',
    });

    const closedWindow = {
      booking_is_open: 0, booking_open_at: null, booking_deadline: new Date(Date.now() - 3_600_000),
      segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 0,
    };
    // 13:00-20:00 and 15:00-20:00 share an END time. Previously this
    // slipped through (only start time was checked) and hit the swap logic
    // with nothing to actually change for one side.
    await db('work_slots').insert([
      { id: senderSlotId, date: day, start_time: '13:00:00', end_time: '20:00:00', duration: 7, capacity: 2, ...closedWindow },
      { id: receiverSlotId, date: day, start_time: '15:00:00', end_time: '20:00:00', duration: 5, capacity: 2, ...closedWindow },
    ]);
    await db('slot_bookings').insert([
      { id: 'a3000000-0000-4000-8000-0000000000a1', slot_id: senderSlotId, user_id: CSR_ID, status: 'confirmed', booked_at: new Date() },
      { id: 'a3000000-0000-4000-8000-0000000000a2', slot_id: receiverSlotId, user_id: receiverId, status: 'confirmed', booked_at: new Date() },
    ]);

    const rejected = await api('POST', '/api/trades', csrToken, {
      receiver_id: receiverId, sender_slot_id: senderSlotId, receiver_slot_id: receiverSlotId,
    });
    expect(rejected.status).toBe(400);
  });

  it('rejects a rest/rest swap outright - it changes nothing', async () => {
    const receiverId = 'a4000000-0000-4000-8000-000000000001';
    const senderRestId = 'a4000000-0000-4000-8000-000000000002';
    const receiverRestId = 'a4000000-0000-4000-8000-000000000003';

    await db('users').insert({
      id: receiverId, email: 'restrest-receiver@test.mn', password_hash: 'x', name: 'RestRest Receiver',
      role: 'csr', status: 'active', segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', code: 'C013',
    });

    const restRow = {
      start_time: '00:00:00', end_time: '00:00:00', duration: 0, capacity: 1,
      booking_is_open: 0, booking_open_at: null, booking_deadline: new Date(Date.now() - 3_600_000),
      segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 1,
    };
    await db('work_slots').insert([
      { id: senderRestId, date: futureDate(13), ...restRow },
      { id: receiverRestId, date: futureDate(14), ...restRow },
    ]);
    await db('slot_bookings').insert([
      { id: 'a4000000-0000-4000-8000-0000000000a1', slot_id: senderRestId, user_id: CSR_ID, status: 'confirmed', booked_at: new Date() },
      { id: 'a4000000-0000-4000-8000-0000000000a2', slot_id: receiverRestId, user_id: receiverId, status: 'confirmed', booked_at: new Date() },
    ]);

    const rejected = await api('POST', '/api/trades', csrToken, {
      receiver_id: receiverId, sender_slot_id: senderRestId, receiver_slot_id: receiverRestId,
    });
    expect(rejected.status).toBe(400);
  });

  it("rejects a trade while the shift's booking window is still open", async () => {
    const receiverId = 'a5000000-0000-4000-8000-000000000001';
    const senderSlotId = 'a5000000-0000-4000-8000-000000000002';
    const receiverSlotId = 'a5000000-0000-4000-8000-000000000003';
    const day = futureDate(15);

    await db('users').insert({
      id: receiverId, email: 'open-receiver@test.mn', password_hash: 'x', name: 'Open Receiver',
      role: 'csr', status: 'active', segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', code: 'C014',
    });

    const openWindow = {
      booking_is_open: 1, booking_open_at: new Date(Date.now() - 3_600_000),
      booking_deadline: new Date(Date.now() + 7 * 86_400_000),
      segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 0,
    };
    await db('work_slots').insert([
      { id: senderSlotId, date: day, start_time: '09:00:00', end_time: '15:00:00', duration: 6, capacity: 2, ...openWindow },
      { id: receiverSlotId, date: day, start_time: '13:00:00', end_time: '20:00:00', duration: 7, capacity: 2, ...openWindow },
    ]);
    await db('slot_bookings').insert([
      { id: 'a5000000-0000-4000-8000-0000000000a1', slot_id: senderSlotId, user_id: CSR_ID, status: 'confirmed', booked_at: new Date() },
      { id: 'a5000000-0000-4000-8000-0000000000a2', slot_id: receiverSlotId, user_id: receiverId, status: 'confirmed', booked_at: new Date() },
    ]);

    const rejected = await api('POST', '/api/trades', csrToken, {
      receiver_id: receiverId, sender_slot_id: senderSlotId, receiver_slot_id: receiverSlotId,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain('нээлттэй');
  });

  it('rejects a second pending trade request from the same sender', async () => {
    const receiverId = 'a6000000-0000-4000-8000-000000000001';
    const receiverId2 = 'a6000000-0000-4000-8000-000000000004';
    const senderSlotId = 'a6000000-0000-4000-8000-000000000002';
    const receiverSlotId = 'a6000000-0000-4000-8000-000000000003';
    const senderSlotId2 = 'a6000000-0000-4000-8000-000000000005';
    const receiverSlotId2 = 'a6000000-0000-4000-8000-000000000006';
    const day = futureDate(16);
    const day2 = futureDate(17);

    await db('users').insert([
      { id: receiverId, email: 'pending1@test.mn', password_hash: 'x', name: 'Pending Receiver 1', role: 'csr', status: 'active', segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', code: 'C015' },
      { id: receiverId2, email: 'pending2@test.mn', password_hash: 'x', name: 'Pending Receiver 2', role: 'csr', status: 'active', segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', code: 'C016' },
    ]);

    const closedWindow = {
      booking_is_open: 0, booking_open_at: null, booking_deadline: new Date(Date.now() - 3_600_000),
      segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 0,
    };
    await db('work_slots').insert([
      { id: senderSlotId, date: day, start_time: '09:00:00', end_time: '15:00:00', duration: 6, capacity: 2, ...closedWindow },
      { id: receiverSlotId, date: day, start_time: '13:00:00', end_time: '20:00:00', duration: 7, capacity: 2, ...closedWindow },
      { id: senderSlotId2, date: day2, start_time: '09:00:00', end_time: '15:00:00', duration: 6, capacity: 2, ...closedWindow },
      { id: receiverSlotId2, date: day2, start_time: '13:00:00', end_time: '20:00:00', duration: 7, capacity: 2, ...closedWindow },
    ]);
    await db('slot_bookings').insert([
      { id: 'a6000000-0000-4000-8000-0000000000a1', slot_id: senderSlotId, user_id: CSR_ID, status: 'confirmed', booked_at: new Date() },
      { id: 'a6000000-0000-4000-8000-0000000000a2', slot_id: receiverSlotId, user_id: receiverId, status: 'confirmed', booked_at: new Date() },
      { id: 'a6000000-0000-4000-8000-0000000000a3', slot_id: senderSlotId2, user_id: CSR_ID, status: 'confirmed', booked_at: new Date() },
      { id: 'a6000000-0000-4000-8000-0000000000a4', slot_id: receiverSlotId2, user_id: receiverId2, status: 'confirmed', booked_at: new Date() },
    ]);

    const first = await api('POST', '/api/trades', csrToken, {
      receiver_id: receiverId, sender_slot_id: senderSlotId, receiver_slot_id: receiverSlotId,
    });
    expect(first.status).toBe(201);

    const second = await api('POST', '/api/trades', csrToken, {
      receiver_id: receiverId2, sender_slot_id: senderSlotId2, receiver_slot_id: receiverSlotId2,
    });
    expect(second.status).toBe(409);

    // Clean up: reject the first so a full run doesn't leave CSR_ID with a
    // dangling pending request that would block every later test in this
    // block (each of which sends from CSR_ID too).
    const receiverToken = tokenFor({ id: receiverId, email: 'pending1@test.mn', role: 'csr', name: 'Pending Receiver 1' });
    await api('PATCH', `/api/trades/${first.body.id}/respond`, receiverToken, { status: 'rejected' });
  });

  it('rejects trading a shift that was already obtained via an earlier trade', async () => {
    const receiverId = 'a7000000-0000-4000-8000-000000000001';
    const thirdPartyId = 'a7000000-0000-4000-8000-000000000004';
    const senderSlotId = 'a7000000-0000-4000-8000-000000000002';
    const receiverSlotId = 'a7000000-0000-4000-8000-000000000003';
    const thirdPartySlotId = 'a7000000-0000-4000-8000-000000000005';
    const day = futureDate(18);

    await db('users').insert([
      { id: receiverId, email: 'acquired-receiver@test.mn', password_hash: 'x', name: 'Acquired Receiver', role: 'csr', status: 'active', segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', code: 'C017' },
      { id: thirdPartyId, email: 'acquired-thirdparty@test.mn', password_hash: 'x', name: 'Acquired ThirdParty', role: 'csr', status: 'active', segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', code: 'C018' },
    ]);

    const closedWindow = {
      booking_is_open: 0, booking_open_at: null, booking_deadline: new Date(Date.now() - 3_600_000),
      segment: 'Postpaid', employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 0,
    };
    await db('work_slots').insert([
      { id: senderSlotId, date: day, start_time: '09:00:00', end_time: '15:00:00', duration: 6, capacity: 2, ...closedWindow },
      { id: receiverSlotId, date: day, start_time: '13:00:00', end_time: '20:00:00', duration: 7, capacity: 2, ...closedWindow },
      { id: thirdPartySlotId, date: day, start_time: '10:00:00', end_time: '18:00:00', duration: 8, capacity: 2, ...closedWindow },
    ]);
    const senderBookingId = 'a7000000-0000-4000-8000-0000000000a1';
    await db('slot_bookings').insert([
      { id: senderBookingId, slot_id: senderSlotId, user_id: CSR_ID, status: 'confirmed', booked_at: new Date() },
      { id: 'a7000000-0000-4000-8000-0000000000a2', slot_id: receiverSlotId, user_id: receiverId, status: 'confirmed', booked_at: new Date() },
      { id: 'a7000000-0000-4000-8000-0000000000a3', slot_id: thirdPartySlotId, user_id: thirdPartyId, status: 'confirmed', booked_at: new Date() },
    ]);

    const created = await api('POST', '/api/trades', csrToken, {
      receiver_id: receiverId, sender_slot_id: senderSlotId, receiver_slot_id: receiverSlotId,
    });
    expect(created.status).toBe(201);

    const receiverToken = tokenFor({ id: receiverId, email: 'acquired-receiver@test.mn', role: 'csr', name: 'Acquired Receiver' });
    const accepted = await api('PATCH', `/api/trades/${created.body.id}/respond`, receiverToken, { status: 'accepted' });
    expect(accepted.status).toBe(200);

    // CSR_ID now holds whatever shift the trade produced on `day` (same
    // booking row, moved slot_id). Trying to trade it again - even against
    // an uninvolved third shift - must be refused.
    const csrNewSlotId = (await db('slot_bookings').where({ id: senderBookingId }).first()).slot_id;
    const secondAttempt = await api('POST', '/api/trades', csrToken, {
      receiver_id: thirdPartyId,
      sender_slot_id: csrNewSlotId,
      receiver_slot_id: thirdPartySlotId,
    });
    expect(secondAttempt.status).toBe(409);
    expect(secondAttempt.body.error).toContain('Trade-ээр авсан');
  });
});

describe('POST /api/slots/sync-schedules - reconciliation deletes', () => {
  it('removes a booked shift along with its bookings, and tells the people who lose them', async () => {
    // Identity is date|start|end|segment|type|location|is_rest, so merely
    // editing a shift's TIME leaves the old row unmatched. That row used to
    // be KEPT whenever somebody had booked it, which left the employee
    // holding a booking on a shift the admin thought was gone - and, since a
    // CSR may hold only one booking per day, locked them out of the
    // replacement. It goes now, but never silently.
    const date = futureDate(1);
    const bookingId = '99999999-9999-4999-8999-999999999999';
    await db('slot_bookings').insert({
      id: bookingId,
      slot_id: SLOT_B, user_id: ADMIN_ID, status: 'confirmed', booked_at: new Date(),
    });
    await db('leave_requests').insert({
      id: '88888888-8888-4888-8888-888888888888',
      user_id: ADMIN_ID, date, start_time: '09:00:00', end_time: '18:00:00',
      reason: 'Pending against a shift about to vanish', status: 'pending',
      slot_booking_id: bookingId,
    });

    const response = await api('POST', '/api/slots/sync-schedules', adminToken, {
      dateKeys: [date],
      scope: { location: 'Ulaanbaatar', segment: 'Postpaid', employmentType: 'Full Time' },
      // SLOT_B is simply absent - the cue to remove it.
      schedules: { [date]: { shifts: [] } },
    });

    expect(response.status).toBe(200);
    expect(await db('work_slots').where({ id: SLOT_B }).first()).toBeFalsy();
    expect(await db('slot_bookings').where({ id: bookingId }).first()).toBeFalsy();

    // The person who lost the shift hears about it...
    const notice = await db('notifications')
      .where({ target_user_id: ADMIN_ID, type: 'schedule_change' })
      .first();
    expect(notice).toBeTruthy();
    expect(notice.content).toContain(date);

    // ...the admin is shown who was affected...
    expect(response.body.removedBookings.length).toBeGreaterThan(0);

    // ...and the pending leave request that hung off the booking is gone,
    // rather than pointing at a shift that no longer exists.
    expect(await db('leave_requests').where({ status: 'pending' }).first()).toBeFalsy();
  });

  it('deletes nothing at all when the request carries no editing scope', async () => {
    // THE BUG: `if (!syncScope?.segment) return true` treated EVERY row on
    // the date as stale, so a save made before the segments fetch resolved -
    // or a segment rename, which passed scope: null for every date in memory
    // - wiped all segments, locations and employment types for those dates.
    const date = futureDate(5);
    const victim = '77777777-7777-4777-8777-777777777777';
    await db('work_slots').insert({
      id: victim, date, start_time: '08:00:00', end_time: '17:00:00', duration: 9,
      capacity: 3, booking_is_open: 0, segment: 'SomeOtherSegment',
      employment_type: 'Part Time', location: 'Darkhan', is_rest: 0,
    });

    const response = await api('POST', '/api/slots/sync-schedules', adminToken, {
      dateKeys: [date],
      schedules: { [date]: { shifts: [] } },
      // no scope
    });

    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(0);
    expect(await db('work_slots').where({ id: victim }).first()).toBeTruthy();
    expect(response.body.skippedUnscopedDates).toBeGreaterThan(0);
  });

  it('still removes an unbooked shift that is in scope, and audits it', async () => {
    const date = futureDate(6);
    const removable = '88888888-8888-4888-8888-888888888888';
    await db('work_slots').insert({
      id: removable, date, start_time: '08:00:00', end_time: '17:00:00', duration: 9,
      capacity: 3, booking_is_open: 0, segment: 'Postpaid',
      employment_type: 'Full Time', location: 'Ulaanbaatar', is_rest: 0,
    });
    await db('trade_requests').insert({
      id: '66666666-6666-4666-8666-777777777777',
      sender_id: CSR_ID,
      receiver_id: ADMIN_ID,
      sender_next_slot_id: removable,
      status: 'pending',
    });

    const response = await api('POST', '/api/slots/sync-schedules', adminToken, {
      dateKeys: [date],
      scope: { location: 'Ulaanbaatar', segment: 'Postpaid', employmentType: 'Full Time' },
      schedules: { [date]: { shifts: [] } },
    });

    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(1);
    expect(await db('work_slots').where({ id: removable }).first()).toBeUndefined();
    expect(await db('trade_requests').where({ id: '66666666-6666-4666-8666-777777777777' }).first()).toBeUndefined();

    const audit = await db('audit_logs').where({ action: 'SYNC_SCHEDULE_DELETED_SLOTS' }).first();
    expect(audit).toBeTruthy();
    expect(audit.details).toContain('Postpaid');
  });

  it('reports shifts it could not store instead of dropping them silently', async () => {
    const date = futureDate(8);
    const response = await api('POST', '/api/slots/sync-schedules', adminToken, {
      dateKeys: [date],
      scope: { location: 'Ulaanbaatar', segment: 'Postpaid', employmentType: 'Full Time' },
      schedules: {
        [date]: {
          shifts: [
            { time: '09-18', segment: 'Postpaid', employmentType: 'Full Time', location: 'Ulaanbaatar', totalSlots: 2 },
            { time: 'nonsense', segment: 'Postpaid', employmentType: 'Full Time', location: 'Ulaanbaatar' },
            { time: '10-19', segment: '', employmentType: 'Full Time', location: 'Ulaanbaatar' },
          ],
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.synced).toBe(1);
    expect(response.body.skipped).toHaveLength(2);
  });
});

describe('GET /api/slots - audience filtering', () => {
  it("does not send colleagues' email addresses to a CSR", async () => {
    const response = await api('GET', '/api/slots', csrToken);
    expect(response.status).toBe(200);
    const bookings = response.body.flatMap((slot: any) => slot.bookings || []);
    expect(bookings.length).toBeGreaterThan(0);
    for (const booking of bookings) {
      expect(booking.userEmail).toBeUndefined();
      // The name IS needed - the roster view shows who is on shift.
      expect(booking).toHaveProperty('userName');
    }
  });

  it("only returns slots matching the CSR's segment, type and location", async () => {
    const response = await api('GET', '/api/slots', csrToken);
    for (const slot of response.body) {
      expect(slot.segment).toBe('Postpaid');
      expect(slot.employmentType).toBe('Full Time');
      expect(slot.location).toBe('Ulaanbaatar');
    }
  });
});

describe('work_slots identity - one shift, one row', () => {
  const shift = () => ({
    date: futureDate(30),
    startTime: '09:00',
    endTime: '18:00',
    capacity: 3,
    segment: 'Postpaid',
    employmentType: 'Full Time',
    location: 'Ulaanbaatar',
    bookingDeadline: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  });

  it('updates in place when the same shift is created twice', async () => {
    // Normal behaviour must be unchanged by the new constraint: POST /slots
    // looks the shift up first and updates it, so a re-save adjusts capacity
    // rather than creating a second row or failing.
    const body = shift();
    const first = await api('POST', '/api/slots', adminToken, body);
    expect(first.status).toBe(201);

    const second = await api('POST', '/api/slots', adminToken, { ...body, capacity: 7 });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const rows = await db('work_slots').where({ date: body.date, start_time: '09:00:00', end_time: '18:00:00' });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].capacity)).toBe(7);
  });

  it('is enforced by the database, not only by the handler', async () => {
    // The point of the constraint: even a writer that skips the lookup - or
    // loses the race between SELECT and INSERT - cannot create the duplicate.
    const body = shift();
    await api('POST', '/api/slots', adminToken, body);

    const row = await db('work_slots').where({ date: body.date, start_time: '09:00:00' }).first();
    const { id: _id, created_at: _c, updated_at: _u, ...identity } = row;

    // A FRESH id, asserted unused first. An earlier version of this test
    // reused an id another test in this file already inserts, so the insert
    // failed on a PRIMARY KEY violation and the test passed whether or not
    // the identity constraint existed at all - green for the wrong reason.
    const freshId = '01234567-89ab-4cde-8f01-234567890abc';
    expect(await db('work_slots').where({ id: freshId })).toHaveLength(0);

    let thrown: any = null;
    try {
      await db('work_slots').insert({ id: freshId, ...identity });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeTruthy();
    // Specifically a uniqueness violation, and specifically NOT the primary
    // key - otherwise this asserts nothing about the new index.
    expect(String(thrown.code || thrown.message)).toMatch(/UNIQUE|2627|2601|23505|unique constraint/i);
    expect(String(thrown.code || '')).not.toMatch(/PRIMARYKEY/i);
    // And the duplicate really did not land.
    expect(await db('work_slots').where(identity)).toHaveLength(1);
  });

  it('still allows a genuinely different shift on the same day', async () => {
    const body = shift();
    await api('POST', '/api/slots', adminToken, body);
    const other = await api('POST', '/api/slots', adminToken, { ...body, startTime: '10:00', endTime: '19:00' });
    expect(other.status).toBe(201);
  });
});
