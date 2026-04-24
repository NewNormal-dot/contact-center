import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';

const router = express.Router();

// Get leave requests
router.get('/leave', authenticate, async (req: any, res) => {
  const { role, id } = req.user;
  try {
    let query = db('leave_requests')
      .join('users', 'leave_requests.user_id', '=', 'users.id')
      .select('leave_requests.*', 'users.name as user_name');

    if (role === 'csr') {
      query = query.where({ 'leave_requests.user_id': id });
    }

    const requests = await query.orderBy('created_at', 'desc');
    const formatted = requests.map(r => ({
      ...r,
      startTime: r.start_time,
      endTime: r.end_time,
      createdAt: r.created_at
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Create Leave Request
router.post('/leave', authenticate, authorize(['csr']), async (req: any, res) => {
  const { date, start_time, end_time, startTime, endTime, reason } = req.body;
  const userId = req.user.id;
  const finalStartTime = start_time || startTime;
  const finalEndTime = end_time || endTime;

  try {
    const id = uuidv4();
    await db('leave_requests').insert({
      id,
      user_id: userId,
      date,
      start_time: finalStartTime,
      end_time: finalEndTime,
      reason,
      status: 'pending'
    });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Approve/Reject Leave (Admin/Superadmin)
router.patch('/leave/:id', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'approved' or 'rejected'
  const actingUserId = req.user.id;

  try {
    await db('leave_requests').where({ id }).update({
      status,
      approved_by: actingUserId,
      updated_at: db.fn.now()
    });
    res.json({ message: 'Амжилттай шинэчлэгдлээ' });
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Vacation Requests... (Similar pattern)
router.get('/vacation', authenticate, async (req: any, res) => {
  const { role, id } = req.user;
  try {
    let query = db('vacation_requests')
      .join('users', 'vacation_requests.user_id', '=', 'users.id')
      .select('vacation_requests.*', 'users.name as user_name');

    if (role === 'csr') {
      query = query.where({ 'vacation_requests.user_id': id });
    }

    const requests = await query.orderBy('created_at', 'desc');
    const formatted = requests.map(r => ({
      ...r,
      startDate: r.start_date,
      endDate: r.end_date,
      createdAt: r.created_at
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

router.post('/vacation', authenticate, authorize(['csr']), async (req: any, res) => {
  const { start_date, end_date, startDate, endDate, reason } = req.body;
  const userId = req.user.id;
  const finalStartDate = start_date || startDate;
  const finalEndDate = end_date || endDate;

  try {
    const id = uuidv4();
    await db('vacation_requests').insert({
      id,
      user_id: userId,
      start_date: finalStartDate,
      end_date: finalEndDate,
      reason,
      status: 'pending'
    });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

export default router;
