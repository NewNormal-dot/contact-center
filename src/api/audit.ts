import express from 'express';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';

const router = express.Router();

router.get('/', authenticate, authorize(['superadmin']), async (req, res) => {
  const { userId, action, entityType, startDate, endDate } = req.query;
  try {
    let query = db('audit_logs')
      .join('users', 'audit_logs.user_id', '=', 'users.id')
      .select('audit_logs.*', 'users.name as user_name', 'users.role as user_role');

    if (userId) query = query.where('audit_logs.user_id', userId as string);
    if (action) query = query.where('audit_logs.action', action as string);
    if (entityType) query = query.where('audit_logs.entity_type', entityType as string);
    if (startDate) query = query.where('audit_logs.created_at', '>=', startDate as string);
    if (endDate) query = query.where('audit_logs.created_at', '<=', endDate as string);

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
      created_at: new Date()
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

export default router;
