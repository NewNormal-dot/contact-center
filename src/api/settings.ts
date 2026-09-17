import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { toSqlDate } from '../utils/sqlDate';
import { captureError } from '../utils/errorLog';
import { logAction } from './audit';
import { makeRuleId } from './rules';

const router = express.Router();

// ===== Holidays =====
// Read: any authenticated user (CSR dashboards need to see holidays too).
// Write: admin/superadmin only.

router.get('/holidays', authenticate, async (_req, res) => {
  try {
    const rows = await db('holidays').select('id', 'date', 'name').orderBy('date', 'asc');
    res.json(rows.map((r: any) => ({ id: r.id, date: r.date, name: r.name })));
  } catch (err: any) {
    console.error('Get holidays error:', err);
    captureError('settings: Get holidays error:', err);
    res.status(500).json({ error: 'Амралтын өдрүүдийг татахад алдаа гарлаа' });
  }
});

// Replaces the ENTIRE holiday list with the one provided. This mirrors how
// the admin UI already computes the full updated list client-side before
// persisting it in one shot, so no separate add/update/delete endpoints are
// needed - the whole list is small (at most a few dozen entries per year).
router.put('/holidays', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const incoming = Array.isArray(req.body?.holidays) ? req.body.holidays : null;
  if (!incoming) {
    return res.status(400).json({ error: 'holidays массив шаардлагатай' });
  }

  try {
    const normalized: { id: string; date: string; name: string }[] = [];
    const seenDates = new Set<string>();
    for (const item of incoming) {
      const date = toSqlDate(item?.date);
      const name = String(item?.name || '').trim();
      if (!date || !name) continue;
      if (seenDates.has(date)) continue; // one holiday per date
      seenDates.add(date);
      const id = typeof item?.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)
        ? item.id
        : uuidv4();
      normalized.push({ id, date, name });
    }

    await db.transaction(async (trx) => {
      await trx('holidays').del();
      if (normalized.length > 0) {
        await trx('holidays').insert(normalized.map((h) => ({
          id: h.id,
          date: h.date,
          name: h.name,
          updated_at: trx.fn.now(),
        })));
      }
    });

    const rows = await db('holidays').select('id', 'date', 'name').orderBy('date', 'asc');
    await logAction(
      req.user.id,
      'UPDATE_HOLIDAYS',
      'holidays',
      null,
      `Holiday list saved (${normalized.length} entr${normalized.length === 1 ? 'y' : 'ies'})`,
    );
    res.json(rows.map((r: any) => ({ id: r.id, date: r.date, name: r.name })));
  } catch (err: any) {
    console.error('Save holidays error:', err);
    captureError('settings: Save holidays error:', err);
    res.status(500).json({ error: 'Амралтын өдрүүдийг хадгалахад алдаа гарлаа' });
  }
});

// ===== Segments =====
// Read: any authenticated user. Write: admin/superadmin only.

router.get('/segments', authenticate, async (_req, res) => {
  try {
    const rows = await db('segments').select('name').orderBy('display_order', 'asc');
    res.json(rows.map((r: any) => r.name));
  } catch (err: any) {
    console.error('Get segments error:', err);
    captureError('settings: Get segments error:', err);
    res.status(500).json({ error: 'Segment жагсаалтыг татахад алдаа гарлаа' });
  }
});

/**
 * Counts everything that still points at a segment by name.
 *
 * `users.segment` and `work_slots.segment` are free strings with no foreign
 * key, so removing or renaming a segment in the `segments` table used to
 * leave those rows pointing at a name that no longer exists. A CSR in an
 * orphaned segment matches no shift in GET /api/slots (the audience filter
 * is an exact segment match) and is shown a permanently empty schedule with
 * no way to book anything.
 */
async function countSegmentReferences(trx: any, name: string) {
  const [userRow] = await trx('users').where({ segment: name }).count('id as count');
  const [slotRow] = await trx('work_slots').where({ segment: name }).count('id as count');
  return {
    users: Number(userRow?.count || 0),
    slots: Number(slotRow?.count || 0),
  };
}

// Renames a segment everywhere it is referenced, atomically.
//
// This used to be done client-side as N separate PUT /users/:id calls
// followed by a POST /slots/sync-schedules carrying the ENTIRE in-memory
// schedule with no scope - which deleted shifts and their bookings (see the
// sync-schedules reconciliation rules). Doing it in one transaction here is
// both correct and vastly cheaper.
router.post('/segments/rename', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const from = String(req.body?.from || '').trim();
  const to = String(req.body?.to || '').trim();

  if (!from || !to) return res.status(400).json({ error: 'Хуучин болон шинэ segment нэр шаардлагатай' });
  if (from === to) return res.json({ renamed: 0 });
  if (to.length > 100) return res.status(400).json({ error: 'Segment нэр хэт урт байна' });

  try {
    const result = await db.transaction(async (trx) => {
      const existing = await trx('segments').where({ name: from }).first();
      if (!existing) return { missing: true as const };

      const clash = await trx('segments').whereRaw('LOWER(name) = ?', [to.toLowerCase()]).first();
      if (clash && String(clash.name) !== from) return { clash: true as const };

      await trx('segments').where({ name: from }).update({ name: to, updated_at: trx.fn.now() });
      const users = await trx('users').where({ segment: from }).update({ segment: to, updated_at: trx.fn.now() });
      const slots = await trx('work_slots').where({ segment: from }).update({ segment: to, updated_at: trx.fn.now() });

      // shift_rule_settings keys its primary key off the segment name, so the
      // id has to be recomputed or a later upsert would insert a duplicate
      // rule row rather than updating this one.
      const ruleRows = await trx('shift_rule_settings').where({ segment: from }).select('*');
      for (const row of ruleRows) {
        const nextId = makeRuleId(row.rule_type, row.month_key, to, row.employment_type, row.location);
        await trx('shift_rule_settings').where({ id: row.id }).update({
          id: nextId,
          segment: to,
          updated_at: trx.fn.now(),
        });
      }

      return { users, slots, rules: ruleRows.length };
    });

    if ('missing' in result) return res.status(404).json({ error: 'Segment олдсонгүй' });
    if ('clash' in result) return res.status(409).json({ error: 'Ийм нэртэй segment аль хэдийн байна' });

    await logAction(
      req.user.id,
      'RENAME_SEGMENT',
      'segments',
      null,
      `Renamed segment "${from}" -> "${to}" (${result.users} user(s), ${result.slots} shift(s), ${result.rules} rule(s))`,
    );

    const rows = await db('segments').select('name').orderBy('display_order', 'asc');
    res.json({ segments: rows.map((r: any) => r.name), ...result });
  } catch (err: any) {
    console.error('Rename segment error:', err);
    captureError('settings: Rename segment error:', err);
    res.status(500).json({ error: 'Segment нэр солиход алдаа гарлаа' });
  }
});

// Replaces the ENTIRE ordered segment list, same rationale as holidays above.
router.put('/segments', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const incoming = Array.isArray(req.body?.segments) ? req.body.segments : null;
  if (!incoming) {
    return res.status(400).json({ error: 'segments массив шаардлагатай' });
  }

  try {
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const item of incoming) {
      const name = String(item || '').trim();
      if (!name || seen.has(name)) continue;
      if (name.length > 100) {
        return res.status(400).json({ error: `Segment нэр хэт урт байна: ${name.slice(0, 20)}…` });
      }
      seen.add(name);
      normalized.push(name);
    }

    // Refuse to drop a segment that CSRs or shifts still point at. Doing so
    // silently stranded those employees with an empty, unbookable schedule.
    const current = await db('segments').select('name');
    const removed = current
      .map((row: any) => String(row.name))
      .filter((name: string) => !seen.has(name));
    if (removed.length > 0) {
      const blocking: string[] = [];
      for (const name of removed) {
        const refs = await countSegmentReferences(db, name);
        if (refs.users > 0 || refs.slots > 0) {
          blocking.push(`${name} (${refs.users} ажилтан, ${refs.slots} ээлж)`);
        }
      }
      if (blocking.length > 0) {
        return res.status(409).json({
          error:
            `Дараах segment-ийг ашиглаж байгаа тул устгах боломжгүй: ${blocking.join('; ')}. ` +
            `Эхлээд ажилтнуудыг өөр segment рүү шилжүүлнэ үү.`,
        });
      }
    }

    await db.transaction(async (trx) => {
      await trx('segments').del();
      if (normalized.length > 0) {
        await trx('segments').insert(normalized.map((name, index) => ({
          id: uuidv4(),
          name,
          display_order: index,
          updated_at: trx.fn.now(),
        })));
      }
    });

    const rows = await db('segments').select('name').orderBy('display_order', 'asc');
    await logAction(
      req.user.id,
      'UPDATE_SEGMENTS',
      'segments',
      null,
      `Segment list saved (${normalized.length}): ${normalized.join(', ')}` +
      `${removed.length > 0 ? ` | removed: ${removed.join(', ')}` : ''}`,
    );
    res.json(rows.map((r: any) => r.name));
  } catch (err: any) {
    console.error('Save segments error:', err);
    captureError('settings: Save segments error:', err);
    res.status(500).json({ error: 'Segment жагсаалтыг хадгалахад алдаа гарлаа' });
  }
});

export default router;
