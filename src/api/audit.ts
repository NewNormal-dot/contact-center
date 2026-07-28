import express from 'express';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { captureError } from '../utils/errorLog';

const router = express.Router();

router.get('/', authenticate, authorize(['superadmin']), async (req, res) => {
  const { userId, action, entityType, startDate, endDate } = req.query;
  try {
    const defaultStart = new Date();
    defaultStart.setMonth(defaultStart.getMonth() - 3);
    const queryStartDate = startDate ? new Date(startDate as string) : defaultStart;

    let query = db('audit_logs')
      .leftJoin('users', 'audit_logs.user_id', '=', 'users.id')
      .select('audit_logs.*', 'users.name as user_name', 'users.role as user_role');

    query = query.where('audit_logs.created_at', '>=', queryStartDate.toISOString());
    if (userId) query = query.andWhere('audit_logs.user_id', userId as string);
    if (action) query = query.andWhere('audit_logs.action', action as string);
    if (entityType) query = query.andWhere('audit_logs.entity_type', entityType as string);
    if (endDate) query = query.andWhere('audit_logs.created_at', '<=', endDate as string);

    const logs = await query.orderBy('audit_logs.created_at', 'desc').limit(200);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

export async function logAction(userId: string, action: string, entityType: string, entityId: string | null, details: string) {
  try {
    const { v4: uuidv4 } = await import('uuid');
    await db('audit_logs').insert({
      id: uuidv4(),
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
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
