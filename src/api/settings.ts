import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { toSqlDate } from '../utils/sqlDate';

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
    res.status(500).json({ error: 'Амралтын өдрүүдийг татахад алдаа гарлаа' });
  }
});

// Replaces the ENTIRE holiday list with the one provided. This mirrors how
// the admin UI already computes the full updated list client-side before
// persisting it in one shot, so no separate add/update/delete endpoints are
// needed - the whole list is small (at most a few dozen entries per year).
router.put('/holidays', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
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
    res.json(rows.map((r: any) => ({ id: r.id, date: r.date, name: r.name })));
  } catch (err: any) {
    console.error('Save holidays error:', err);
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
    res.status(500).json({ error: 'Segment жагсаалтыг татахад алдаа гарлаа' });
  }
});

// Replaces the ENTIRE ordered segment list, same rationale as holidays above.
router.put('/segments', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
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
      seen.add(name);
      normalized.push(name);
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
    res.json(rows.map((r: any) => r.name));
  } catch (err: any) {
    console.error('Save segments error:', err);
    res.status(500).json({ error: 'Segment жагсаалтыг хадгалахад алдаа гарлаа' });
  }
});

export default router;
