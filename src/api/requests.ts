import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { toSqlDate, toSqlTime, displayDate, displayTime } from '../utils/sqlDate';

const router = express.Router();

function mapLeave(row: any) {
  return {
    ...row,
    userId: row.user_id,
    userName: row.user_name,
    date: displayDate(row.date),
    startTime: displayTime(row.start_time),
    endTime: displayTime(row.end_time),
    createdAt: row.created_at,
    approvedBy: row.approved_by,
  };
}

function mapVacation(row: any) {
  return {
    ...row,
    userId: row.user_id,
    userName: row.user_name,
    startDate: displayDate(row.start_date),
    endDate: displayDate(row.end_date),
    createdAt: row.created_at,
    approvedBy: row.approved_by,
  };
}

router.get('/leave', authenticate, async (req: any, res) => {
  const { role, id } = req.user;
  try {
    let query = db('leave_requests')
      .join('users', 'leave_requests.user_id', '=', 'users.id')
      .select('leave_requests.*', 'users.name as user_name');

    if (role === 'csr') query = query.where({ 'leave_requests.user_id': id });

    const requests = await query.orderBy('created_at', 'desc');
    res.json(requests.map(mapLeave));
  } catch (err) {
    console.error('Get leave requests error:', err);
    res.status(500).json({ error: 'Чөлөөний хүсэлт татахад алдаа гарлаа' });
  }
});

router.post('/leave', authenticate, authorize(['csr']), async (req: any, res) => {
  const { date, start_time, end_time, startTime, endTime, reason } = req.body;
  const userId = req.user.id;
  const finalDate = toSqlDate(date);
  const finalStartTime = toSqlTime(start_time || startTime);
  const finalEndTime = toSqlTime(end_time || endTime);

  if (!finalDate || !finalStartTime || !finalEndTime || !reason) {
    return res.status(400).json({ error: 'Огноо, цаг болон шалтгааныг зөв оруулна уу' });
  }

  try {
    const id = uuidv4();
    await db('leave_requests').insert({
      id,
      user_id: userId,
      date: finalDate,
      start_time: finalStartTime,
      end_time: finalEndTime,
      reason,
      status: 'pending',
    });
    res.status(201).json({ id });
  } catch (err) {
    console.error('Create leave request error:', err);
    res.status(500).json({ error: 'Чөлөөний хүсэлт үүсгэхэд алдаа гарлаа' });
  }
});

router.patch('/leave/:id', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const actingUserId = req.user.id;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Төлөв буруу байна' });
  }

  try {
    await db('leave_requests').where({ id }).update({
      status,
      approved_by: actingUserId,
      updated_at: db.fn.now(),
    });
    res.json({ message: 'Амжилттай шинэчлэгдлээ' });
  } catch (err) {
    console.error('Update leave request error:', err);
    res.status(500).json({ error: 'Хүсэлт шинэчлэхэд алдаа гарлаа' });
  }
});

router.get('/vacation', authenticate, async (req: any, res) => {
  const { role, id } = req.user;
  try {
    let query = db('vacation_requests')
      .join('users', 'vacation_requests.user_id', '=', 'users.id')
      .select('vacation_requests.*', 'users.name as user_name');

    if (role === 'csr') query = query.where({ 'vacation_requests.user_id': id });

    const requests = await query.orderBy('created_at', 'desc');
    res.json(requests.map(mapVacation));
  } catch (err) {
    console.error('Get vacation requests error:', err);
    res.status(500).json({ error: 'Амралтын хүсэлт татахад алдаа гарлаа' });
  }
});

router.post('/vacation', authenticate, authorize(['csr']), async (req: any, res) => {
  const { start_date, end_date, startDate, endDate, reason } = req.body;
  const userId = req.user.id;
  const finalStartDate = toSqlDate(start_date || startDate);
  const finalEndDate = toSqlDate(end_date || endDate);

  if (!finalStartDate || !finalEndDate || !reason) {
    return res.status(400).json({ error: 'Эхлэх/дуусах огноо болон шалтгааныг зөв оруулна уу' });
  }

  try {
    const id = uuidv4();
    await db('vacation_requests').insert({
      id,
      user_id: userId,
      start_date: finalStartDate,
      end_date: finalEndDate,
      reason,
      status: 'pending',
    });
    res.status(201).json({ id });
  } catch (err) {
    console.error('Create vacation request error:', err);
    res.status(500).json({ error: 'Амралтын хүсэлт үүсгэхэд алдаа гарлаа' });
  }
});

router.patch('/vacation/:id', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const actingUserId = req.user.id;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Төлөв буруу байна' });
  }

  try {
    await db('vacation_requests').where({ id }).update({
      status,
      approved_by: actingUserId,
      updated_at: db.fn.now(),
    });
    res.json({ message: 'Амжилттай шинэчлэгдлээ' });
  } catch (err) {
    console.error('Update vacation request error:', err);
    res.status(500).json({ error: 'Хүсэлт шинэчлэхэд алдаа гарлаа' });
  }
});

export default router;
