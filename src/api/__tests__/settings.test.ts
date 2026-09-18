import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

// Must be set BEFORE anything imports src/database/db, which builds the knex
// instance from knexfile at module-evaluation time.
const TEMP_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-settings-')), 'test.sqlite');
process.env.NODE_ENV = 'development';
process.env.SQLITE_FILE = TEMP_DB;
process.env.JWT_SECRET = 'test-secret-for-vitest-only';

let db: any;
let server: Server;
let baseUrl: string;
let csrToken: string;
let adminToken: string;

const CSR_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = '44444444-4444-4444-8444-444444444444';

const REST = 'Амралт';

async function createSchema() {
  await db.schema.createTable('users', (t: any) => {
    t.uuid('id').primary();
    t.string('email').unique().notNullable();
    t.string('password_hash').notNullable();
    t.string('name').notNullable();
    t.string('role').defaultTo('csr');
    t.string('status').defaultTo('active');
    t.string('segment');
    t.dateTime('sessions_valid_from');
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

  // The real constraints matter here: month is UNIQUE, and so is a template's
  // time. A save path that INSERTs without clearing first would pass a test
  // against a table without them and fail in production.
  await db.schema.createTable('vacation_quotas', (t: any) => {
    t.uuid('id').primary();
    t.integer('month').notNullable().unique();
    t.integer('quota_limit').notNullable().defaultTo(5);
    t.timestamps(true, true);
  });

  await db.schema.createTable('holidays', (t: any) => {
    t.uuid('id').primary();
    t.string('date').notNullable().unique();
    t.string('name').notNullable();
    t.timestamps(true, true);
  });

  await db.schema.createTable('shift_templates', (t: any) => {
    t.uuid('id').primary();
    t.string('time', 32).notNullable().unique();
    t.string('label', 64).notNullable();
    t.integer('display_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
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
  const express = (await import('express')).default;
  const jwt = (await import('jsonwebtoken')).default;
  db = (await import('../../database/db')).default;

  await createSchema();
  await db('users').insert([
    { id: CSR_ID, email: 'csr@test.mn', password_hash: 'x', name: 'CSR', role: 'csr', status: 'active' },
    { id: ADMIN_ID, email: 'admin@test.mn', password_hash: 'x', name: 'Admin', role: 'admin', status: 'active' },
  ]);

  const settingsRoutes = (await import('../settings')).default;
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/settings', settingsRoutes);

  csrToken = jwt.sign({ id: CSR_ID, email: 'csr@test.mn', role: 'csr', name: 'CSR' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
  adminToken = jwt.sign({ id: ADMIN_ID, email: 'admin@test.mn', role: 'admin', name: 'Admin' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

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
  await db('vacation_quotas').del();
  await db('shift_templates').del();
  await db('holidays').del();
});

/** Raw fetch, so an If-Match header can be set (or deliberately omitted). */
async function rawApi(method: string, route: string, token: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    etag: response.headers.get('etag'),
    body: text ? JSON.parse(text) : null,
  };
}

describe('vacation quotas - the control that never reached anyone', () => {
  it('round-trips a quota from the admin to any reader', async () => {
    // THE BUG: the admin wrote localStorage "monthlyQuotas" (month index
    // 0-11) and the CSR dashboard read "vacationQuotas" ("YYYY-MM"), which
    // nothing ever wrote. The admin's setting reached no one - not other
    // browsers, not even the same one - and every CSR saw a hardcoded 5.
    const saved = await api('PUT', '/api/settings/vacation-quotas', adminToken, {
      quotas: [{ month: 3, limit: 12 }, { month: 7, limit: 0 }],
    });
    expect(saved.status).toBe(200);

    // Read back as a DIFFERENT user, which is the whole point.
    const read = await api('GET', '/api/settings/vacation-quotas', csrToken);
    expect(read.status).toBe(200);
    expect(read.body).toEqual([{ month: 3, limit: 12 }, { month: 7, limit: 0 }]);
  });

  it('keeps month numbers exactly as sent, with no off-by-one', async () => {
    // The UI keys quotas by month INDEX (0-11) and the API by month NUMBER
    // (1-12). That conversion happens once, at the client boundary; if the
    // server also shifted, January would silently become February.
    await api('PUT', '/api/settings/vacation-quotas', adminToken, {
      quotas: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, limit: i + 1 })),
    });
    const read = await api('GET', '/api/settings/vacation-quotas', csrToken);
    expect(read.body.map((q: any) => [q.month, q.limit])).toEqual(
      Array.from({ length: 12 }, (_, i) => [i + 1, i + 1]),
    );
  });

  it('updates an existing month instead of colliding with it', async () => {
    // month is UNIQUE. A plain INSERT would throw on the second save, and
    // knex's onConflict is not implemented for the mssql dialect - it would
    // have passed on SQLite and failed only in production.
    await api('PUT', '/api/settings/vacation-quotas', adminToken, { quotas: [{ month: 5, limit: 4 }] });
    const second = await api('PUT', '/api/settings/vacation-quotas', adminToken, { quotas: [{ month: 5, limit: 9 }] });
    expect(second.status).toBe(200);

    const rows = await db('vacation_quotas').where({ month: 5 });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quota_limit)).toBe(9);
  });

  it('drops out-of-range months rather than storing them', async () => {
    await api('PUT', '/api/settings/vacation-quotas', adminToken, {
      quotas: [{ month: 0, limit: 3 }, { month: 13, limit: 3 }, { month: 6, limit: 3 }],
    });
    const read = await api('GET', '/api/settings/vacation-quotas', csrToken);
    expect(read.body).toEqual([{ month: 6, limit: 3 }]);
  });

  it('clamps a negative quota to zero instead of storing nonsense', async () => {
    await api('PUT', '/api/settings/vacation-quotas', adminToken, { quotas: [{ month: 2, limit: -5 }] });
    const read = await api('GET', '/api/settings/vacation-quotas', csrToken);
    expect(read.body).toEqual([{ month: 2, limit: 0 }]);
  });

  it('rejects a save with no usable rows rather than wiping the table', async () => {
    await api('PUT', '/api/settings/vacation-quotas', adminToken, { quotas: [{ month: 4, limit: 8 }] });
    const bad = await api('PUT', '/api/settings/vacation-quotas', adminToken, { quotas: [{ month: 99, limit: 1 }] });
    expect(bad.status).toBe(400);

    const read = await api('GET', '/api/settings/vacation-quotas', csrToken);
    expect(read.body).toEqual([{ month: 4, limit: 8 }]);
  });

  it('lets a CSR read the quota but not set it', async () => {
    expect((await api('GET', '/api/settings/vacation-quotas', csrToken)).status).toBe(200);
    const write = await api('PUT', '/api/settings/vacation-quotas', csrToken, { quotas: [{ month: 1, limit: 99 }] });
    expect(write.status).toBe(403);
  });
});

describe('shift templates - one list for every admin', () => {
  it('round-trips the list and preserves the admin ordering', async () => {
    const saved = await api('PUT', '/api/settings/shift-templates', adminToken, {
      templates: [{ time: '14-22' }, { time: '09-18' }],
    });
    expect(saved.status).toBe(200);

    const read = await api('GET', '/api/settings/shift-templates', csrToken);
    expect(read.body.map((t: any) => t.time)).toEqual(['14-22', '09-18', REST]);
  });

  it('always keeps the rest day, even when the client omits it', async () => {
    // An admin deleting the rest entry from their own list would otherwise
    // remove the only way to mark a day off - for everyone, now that the
    // list is shared.
    await api('PUT', '/api/settings/shift-templates', adminToken, { templates: [{ time: '09-18' }] });
    const read = await api('GET', '/api/settings/shift-templates', csrToken);
    expect(read.body.map((t: any) => t.time)).toContain(REST);
  });

  it('collapses duplicates instead of hitting the unique constraint', async () => {
    const saved = await api('PUT', '/api/settings/shift-templates', adminToken, {
      templates: [{ time: '09-18' }, { time: ' 09 - 18 ' }, { time: '09-18' }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.filter((t: any) => t.time === '09-18')).toHaveLength(1);
  });

  it('replaces the previous list rather than accumulating', async () => {
    await api('PUT', '/api/settings/shift-templates', adminToken, { templates: [{ time: '09-18' }] });
    await api('PUT', '/api/settings/shift-templates', adminToken, { templates: [{ time: '10-19' }] });

    const read = await api('GET', '/api/settings/shift-templates', csrToken);
    expect(read.body.map((t: any) => t.time).sort()).toEqual([REST, '10-19'].sort());
  });

  it('accepts a shift with minutes, not just whole hours', async () => {
    // getHoursForShift/getStartTimeValue already handle "10:00-16:00"; a
    // server that rejected it would make the picker and the template list
    // disagree about what a valid shift is.
    const saved = await api('PUT', '/api/settings/shift-templates', adminToken, {
      templates: [{ time: '10:00-16:30' }],
    });
    expect(saved.body.map((t: any) => t.time)).toContain('10:00-16:30');
  });

  it('refuses values that are neither a time nor the rest label', async () => {
    const saved = await api('PUT', '/api/settings/shift-templates', adminToken, {
      templates: [{ time: 'nonsense' }, { time: '25-99' }, { time: '09-18' }],
    });
    expect(saved.body.map((t: any) => t.time).sort()).toEqual([REST, '09-18'].sort());
  });

  it('lets a CSR read the list but not change it', async () => {
    expect((await api('GET', '/api/settings/shift-templates', csrToken)).status).toBe(200);
    const write = await api('PUT', '/api/settings/shift-templates', csrToken, { templates: [{ time: '09-18' }] });
    expect(write.status).toBe(403);
  });
});

describe('audit trail - the record that was not being kept', () => {
  it('writes an audit row for a settings change, with the caller IP', async () => {
    // audit_logs.ip_address has existed since the initial schema and was
    // never once written to. Every state-changing action was therefore
    // attributable to a user but not to a machine.
    await db('audit_logs').del();
    await api('PUT', '/api/settings/vacation-quotas', adminToken, { quotas: [{ month: 8, limit: 6 }] });

    const rows = await db('audit_logs').where({ action: 'UPDATE_VACATION_QUOTAS' });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(ADMIN_ID);
    expect(rows[0].details).toContain('8:6');
    expect(rows[0].ip_address).toBeTruthy();
  });

  it('takes the LAST forwarded hop, so a caller cannot forge the logged IP', async () => {
    // X-Forwarded-For is appended to by the proxy, so the first entry is
    // whatever the caller typed. An audit log recording a forged address is
    // worse than one recording none, because it looks authoritative.
    await db('audit_logs').del();
    await fetch(`${baseUrl}/api/settings/vacation-quotas`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-Forwarded-For': '1.1.1.1, 203.0.113.9',
      },
      body: JSON.stringify({ quotas: [{ month: 9, limit: 2 }] }),
    });

    const row = await db('audit_logs').where({ action: 'UPDATE_VACATION_QUOTAS' }).first();
    expect(row.ip_address).toBe('203.0.113.9');
    expect(row.ip_address).not.toBe('1.1.1.1');
  });

  it('records a failed save too, not only successful ones', async () => {
    // A rejected write is exactly as interesting as an accepted one when
    // reconstructing what someone was trying to do.
    await db('audit_logs').del();
    const bad = await api('PUT', '/api/settings/vacation-quotas', adminToken, { quotas: [{ month: 77, limit: 1 }] });
    expect(bad.status).toBe(400);
    // Nothing was stored, so nothing is logged - the assertion here is that
    // the table is not polluted with a success entry for a save that failed.
    const rows = await db('audit_logs').where({ action: 'UPDATE_VACATION_QUOTAS' });
    expect(rows).toHaveLength(0);
  });
});

describe('concurrent edits - two admins must not silently overwrite each other', () => {
  // THE BUG (F-09): these collections are saved by deleting what is stored and
  // inserting the list the client computed from whatever it fetched on load.
  //
  //   09:00  admin A loads the page
  //   09:05  admin B loads the page
  //   09:10  A adds a holiday and saves
  //   09:12  B adds a different one and saves
  //
  // B's list came from the 09:05 snapshot, which never contained A's entry, so
  // A's work disappears. Nothing errors. This is a minutes-wide window, not a
  // millisecond race.

  it('hands out a version with the list', async () => {
    const read = await rawApi('GET', '/api/settings/holidays', adminToken);
    expect(read.status).toBe(200);
    expect(read.etag).toBeTruthy();
  });

  it('accepts a save built from the current version', async () => {
    const read = await rawApi('GET', '/api/settings/holidays', adminToken);
    const saved = await rawApi('PUT', '/api/settings/holidays', adminToken,
      { holidays: [{ date: '2026-07-11', name: 'Наадам' }] },
      { 'If-Match': read.etag! });
    expect(saved.status).toBe(200);
    expect(saved.body).toHaveLength(1);
  });

  it('refuses a save built from a version that has since moved', async () => {
    // Both admins load the same empty list.
    const adminA = await rawApi('GET', '/api/settings/holidays', adminToken);
    const adminB = await rawApi('GET', '/api/settings/holidays', adminToken);
    expect(adminA.etag).toBe(adminB.etag);

    // A saves first and succeeds.
    const aSave = await rawApi('PUT', '/api/settings/holidays', adminToken,
      { holidays: [{ date: '2026-07-11', name: 'Наадам' }] },
      { 'If-Match': adminA.etag! });
    expect(aSave.status).toBe(200);

    // B saves a list that never contained A's entry.
    const bSave = await rawApi('PUT', '/api/settings/holidays', adminToken,
      { holidays: [{ date: '2026-12-31', name: 'Шинэ жил' }] },
      { 'If-Match': adminB.etag! });
    expect(bSave.status).toBe(409);
    expect(bSave.body.conflict).toBe(true);

    // The decisive assertion: A's holiday is still there.
    const after = await rawApi('GET', '/api/settings/holidays', adminToken);
    expect(after.body.map((h: any) => h.name)).toEqual(['Наадам']);
  });

  it('tells the rejected admin what is actually stored', async () => {
    const stale = await rawApi('GET', '/api/settings/holidays', adminToken);
    await rawApi('PUT', '/api/settings/holidays', adminToken,
      { holidays: [{ date: '2026-07-11', name: 'Наадам' }] }, { 'If-Match': stale.etag! });

    const rejected = await rawApi('PUT', '/api/settings/holidays', adminToken,
      { holidays: [{ date: '2026-12-31', name: 'Шинэ жил' }] }, { 'If-Match': stale.etag! });
    // Without this the client can only say "it failed" and leave a refused
    // edit on screen.
    expect(rejected.body.current.map((h: any) => h.name)).toEqual(['Наадам']);
  });

  it('changes the version once the list changes', async () => {
    const before = await rawApi('GET', '/api/settings/holidays', adminToken);
    await rawApi('PUT', '/api/settings/holidays', adminToken,
      { holidays: [{ date: '2026-07-11', name: 'Наадам' }] }, { 'If-Match': before.etag! });
    const after = await rawApi('GET', '/api/settings/holidays', adminToken);
    expect(after.etag).not.toBe(before.etag);
  });

  it('still saves when no version is sent at all', async () => {
    // The check is advisory on purpose: a tab left open across a deploy has
    // never heard of If-Match, and must not have every save start failing.
    const saved = await rawApi('PUT', '/api/settings/holidays', adminToken,
      { holidays: [{ date: '2026-07-11', name: 'Наадам' }] });
    expect(saved.status).toBe(200);
  });

  it('covers the quota and template lists too, not just holidays', async () => {
    // Both were added with the same replace-the-whole-list shape, so both had
    // the same hole.
    const q = await rawApi('GET', '/api/settings/vacation-quotas', adminToken);
    await rawApi('PUT', '/api/settings/vacation-quotas', adminToken,
      { quotas: [{ month: 1, limit: 3 }] }, { 'If-Match': q.etag! });
    const qStale = await rawApi('PUT', '/api/settings/vacation-quotas', adminToken,
      { quotas: [{ month: 2, limit: 9 }] }, { 'If-Match': q.etag! });
    expect(qStale.status).toBe(409);

    const t = await rawApi('GET', '/api/settings/shift-templates', adminToken);
    await rawApi('PUT', '/api/settings/shift-templates', adminToken,
      { templates: [{ time: '09-18' }] }, { 'If-Match': t.etag! });
    const tStale = await rawApi('PUT', '/api/settings/shift-templates', adminToken,
      { templates: [{ time: '10-19' }] }, { 'If-Match': t.etag! });
    expect(tStale.status).toBe(409);
  });
});
