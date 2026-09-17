import express from 'express';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { captureError } from '../utils/errorLog';
import { getClientKey } from '../middleware/rateLimiter';

const router = express.Router();

router.get('/', authenticate, authorize(['superadmin']), async (req, res) => {
  const { userId, action, entityType, startDate, endDate } = req.query;
  try {
    const defaultStart = new Date();
    defaultStart.setMonth(defaultStart.getMonth() - 3);
    // An unparseable ?startDate made toISOString() throw and the whole
    // request 500 - a bad link was enough to break the page.
    const parsedStart = startDate ? new Date(startDate as string) : defaultStart;
    const queryStartDate = Number.isNaN(parsedStart.getTime()) ? defaultStart : parsedStart;

    // The log was capped at 200 rows with no way to page, so the superadmin
    // could never reach the 201st entry.
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    let query = db('audit_logs')
      .leftJoin('users', 'audit_logs.user_id', '=', 'users.id')
      .select('audit_logs.*', 'users.name as user_name', 'users.role as user_role');

    query = query.where('audit_logs.created_at', '>=', queryStartDate.toISOString());
    if (userId) query = query.andWhere('audit_logs.user_id', userId as string);
    if (action) query = query.andWhere('audit_logs.action', action as string);
    if (entityType) query = query.andWhere('audit_logs.entity_type', entityType as string);
    if (endDate) query = query.andWhere('audit_logs.created_at', '<=', endDate as string);


    if (endDate) {
      const parsedEnd = new Date(endDate as string);
      if (Number.isNaN(parsedEnd.getTime())) {
        return res.status(400).json({ error: 'endDate буруу форматтай байна' });
      }
    }

    const logs = await query
      .orderBy('audit_logs.created_at', 'desc')
      .limit(limit)
      .offset(offset);
    res.json(logs);
  } catch (err) {
    console.error('Get audit log error:', err);
    captureError('audit: GET /api/audit', err);
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

/**
 * The caller's IP, for the audit trail.
 *
 * Reuses the rate limiter's key function rather than reading
 * x-forwarded-for[0]: that header is client-controlled and the proxy
 * APPENDS to it, so the first entry is whatever the caller typed. An audit
 * log that records a forged address is worse than one that records none,
 * because it looks authoritative.
 */
export function clientIpFor(req: any): string | null {
  try {
    return getClientKey(req) || null;
  } catch {
    return null;
  }
}

export async function logAction(
  userId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  details: string,
  // Optional so the ~30 existing call sites keep working unchanged; passing
  // the request is what fills audit_logs.ip_address, a column that had
  // existed since the initial schema and was never once written to.
  req?: any,
) {
  try {
    const { v4: uuidv4 } = await import('uuid');
    await db('audit_logs').insert({
      id: uuidv4(),
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
      ip_address: req ? clientIpFor(req) : null,
      created_at: new Date().toISOString()
    });

    // Previously this cleanup DELETE ran on every single logAction call
    // (i.e. on every login, booking, edit, etc across the whole app) - an
    // extra full-table scan/delete on the hot path of common actions like
    // login. It only needs to run occasionally to keep the table from
    // growing unbounded, so it's now gated to roughly 1 in 50 calls.
    if (Math.random() < 0.02) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 3);
      await db('audit_logs').where('created_at', '<', cutoff.toISOString()).del();
    }
  } catch (err) {
    console.error('Audit log error:', err);
    captureError('audit: Audit log error:', err);
  }
}

export default router;
