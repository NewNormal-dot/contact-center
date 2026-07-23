import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { toSqlDate, toSqlTime, toSqlDateTime, displayDate, displayTime } from '../utils/sqlDate';

const router = express.Router();

async function createNotificationForUser(params: {
  userId: string;
  title: string;
  content: string;
  type: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  authorId?: string;
}) {
  await db('notifications').insert({
    id: uuidv4(),
    title: params.title,
    content: params.content,
    type: params.type,
    target_user_id: params.userId,
    related_entity_type: params.relatedEntityType || null,
    related_entity_id: params.relatedEntityId || null,
    author_id: params.authorId || null,
  });
}

async function createNotificationForAdmins(params: {
  title: string;
  content: string;
  type: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  authorId?: string;
}) {
  const admins = await db('users')
    .where({ role: 'admin', status: 'active' })
    .select('id');

  if (admins.length === 0) return;

  await db('notifications').insert(
    admins.map((admin: any) => ({
      id: uuidv4(),
      title: params.title,
      content: params.content,
      type: params.type,
      target_user_id: admin.id,
      related_entity_type: params.relatedEntityType || null,
      related_entity_id: params.relatedEntityId || null,
      author_id: params.authorId || null,
    }))
  );
}


function mapLeave(row: any) {
  return {
    ...row,
    userId: row.user_id,
    userName: row.user_name,
    date: displayDate(row.date),
    endDate: row.end_date ? displayDate(row.end_date) : undefined,
    startTime: displayTime(row.start_time),
    endTime: displayTime(row.end_time),
    type: row.type || 'hourly',
    comment: row.comment || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    approvedBy: row.approved_by,
    approvedByName: row.approver_name || undefined,
    slotBookingId: row.slot_booking_id || undefined,
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
      .leftJoin('users as approvers', 'leave_requests.approved_by', '=', 'approvers.id')
      .select('leave_requests.*', 'users.name as user_name', 'approvers.name as approver_name');

    if (role === 'csr') query = query.where({ 'leave_requests.user_id': id });

    const requests = await query.orderBy('created_at', 'desc');
    res.json(requests.map(mapLeave));
  } catch (err) {
    console.error('Get leave requests error:', err);
    res.status(500).json({ error: 'Чөлөөний хүсэлт татахад алдаа гарлаа' });
  }
});

router.post('/leave', authenticate, authorize(['csr']), async (req: any, res) => {
  const { date, end_date, endDate, start_time, end_time, startTime, endTime, reason, type, slotBookingId, slot_booking_id } = req.body;
  const userId = req.user.id;
  const requestedSlotBookingId = slotBookingId || slot_booking_id || null;

  // Urgent shift-leave: the CSR already has a CONFIRMED booking for a
  // specific shift and something came up. Instead of the CSR typing in
  // date/time by hand, we look up the real booking, verify it belongs to
  // them, and require at least 8 hours' notice before that shift starts.
  if (requestedSlotBookingId) {
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'Шалтгаанаа оруулна уу' });
    }

    try {
      const booking = await db('slot_bookings')
        .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
        .where({ 'slot_bookings.id': requestedSlotBookingId })
        .select('slot_bookings.*', 'work_slots.date as slot_date', 'work_slots.start_time as slot_start_time', 'work_slots.end_time as slot_end_time')
        .first();

      if (!booking) return res.status(404).json({ error: 'Захиалга олдсонгүй' });
      if (booking.user_id !== userId) {
        return res.status(403).json({ error: 'Энэ захиалга танд хамаарахгүй байна' });
      }
      if (booking.status !== 'confirmed') {
        return res.status(400).json({ error: 'Энэ захиалга идэвхгүй байна' });
      }

      const existingRequest = await db('leave_requests')
        .where({ slot_booking_id: requestedSlotBookingId })
        .whereIn('status', ['pending', 'approved'])
        .first();
      if (existingRequest) {
        return res.status(400).json({ error: 'Энэ ээлжид аль хэдийн чөлөөний хүсэлт илгээгдсэн байна' });
      }

      const shiftStart = toSqlDateTime(`${booking.slot_date}T${booking.slot_start_time}`);
      if (!shiftStart) return res.status(400).json({ error: 'Ээлжийн цагийг тодорхойлж чадсангүй' });

      const hoursUntilShift = (shiftStart.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilShift < 8) {
        return res.status(400).json({
          error: hoursUntilShift < 0
            ? 'Энэ ээлж аль хэдийн эхэлсэн эсвэл өнгөрсөн байна'
            : `Ээлж эхлэхэд дор хаяж 8 цаг үлдсэн байх ёстой (одоогоор ${hoursUntilShift.toFixed(1)} цаг үлдсэн байна)`,
        });
      }

      const id = uuidv4();
      await db('leave_requests').insert({
        id,
        user_id: userId,
        slot_booking_id: requestedSlotBookingId,
        date: booking.slot_date,
        end_date: booking.slot_date,
        start_time: booking.slot_start_time,
        end_time: booking.slot_end_time,
        type: 'shift_leave',
        reason,
        status: 'pending',
      });

      const user = await db('users').where({ id: userId }).first();
      await createNotificationForAdmins({
        title: 'Яаралтай чөлөөний хүсэлт',
        content: `${user?.name || 'CSR'} нь ${displayDate(booking.slot_date)} өдрийн ${displayTime(booking.slot_start_time)}-${displayTime(booking.slot_end_time)} ээлжинд яаралтай чөлөө хүссэн байна. Шалтгаан: ${reason}`,
        type: 'leave_request',
        relatedEntityType: 'leave_request',
        relatedEntityId: id,
        authorId: userId,
      });

      return res.status(201).json({ id });
    } catch (err) {
      console.error('Create shift leave request error:', err);
      return res.status(500).json({ error: 'Чөлөөний хүсэлт үүсгэхэд алдаа гарлаа' });
    }
  }

  const leaveType = type === 'daily' ? 'daily' : 'hourly';
  const finalDate = toSqlDate(date);
  const finalEndDate = toSqlDate(end_date || endDate || date);
  const finalStartTime = toSqlTime(start_time || startTime || (leaveType === 'daily' ? '09:00' : ''));
  const finalEndTime = toSqlTime(end_time || endTime || (leaveType === 'daily' ? '18:00' : ''));

  if (!finalDate || !finalStartTime || !finalEndTime || !reason) {
    return res.status(400).json({ error: 'Огноо, цаг болон шалтгааныг зөв оруулна уу' });
  }

  try {
    const id = uuidv4();

    await db('leave_requests').insert({
      id,
      user_id: userId,
      date: finalDate,
      end_date: finalEndDate,
      start_time: finalStartTime,
      end_time: finalEndTime,
      type: leaveType,
      reason,
      status: 'pending',
    });

    const user = await db('users').where({ id: userId }).first();

    await createNotificationForAdmins({
      title: 'Шинэ чөлөөний хүсэлт',
      content: `${user?.name || 'CSR'} ${leaveType === 'daily' ? 'өдрийн' : 'цагийн'} чөлөө хүссэн байна. Огноо: ${finalDate}${leaveType === 'daily' && finalEndDate && finalEndDate !== finalDate ? ` - ${finalEndDate}` : ''}.`,
      type: 'leave_request',
      relatedEntityType: 'leave_request',
      relatedEntityId: id,
      authorId: userId,
    });

    res.status(201).json({ id });
  } catch (err) {
    console.error('Create leave request error:', err);
    res.status(500).json({ error: 'Чөлөөний хүсэлт үүсгэхэд алдаа гарлаа' });
  }
});

router.patch('/leave/:id', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { id } = req.params;
  const { status, comment } = req.body;
  const actingUserId = req.user.id;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Төлөв буруу байна' });
  }

  try {
    const request = await db('leave_requests')
      .join('users', 'leave_requests.user_id', '=', 'users.id')
      .where({ 'leave_requests.id': id })
      .select('leave_requests.*', 'users.name as user_name')
      .first();

    if (!request) {
      return res.status(404).json({ error: 'Хүсэлт олдсонгүй' });
    }

    // Deliberately does NOT touch slot_bookings at all - the booking stays
    // exactly as 'confirmed'. Booking is already closed for a published
    // schedule, so this seat is not meant to be reassigned to anyone else;
    // approving urgent leave just excuses this person from working it
    // (reflected in exports/reports), without freeing capacity for others.

    await db('leave_requests').where({ id }).update({
      status,
      comment: comment || null,
      approved_by: actingUserId,
      updated_at: db.fn.now(),
    });

    const isApproved = status === 'approved';
    const actingUser = await db('users').where({ id: actingUserId }).first();
    const isShiftLeave = request.type === 'shift_leave';

    await createNotificationForUser({
      userId: request.user_id,
      title: isApproved ? 'Чөлөөний хүсэлт зөвшөөрөгдлөө' : 'Чөлөөний хүсэлт татгалзагдлаа',
      content: isApproved
        ? `Таны ${isShiftLeave ? `${displayDate(request.date)} ${displayTime(request.start_time)}-${displayTime(request.end_time)} ээлжийн` : request.type === 'daily' ? 'өдрийн' : 'цагийн'} чөлөөний хүсэлтийг ${actingUser?.name || 'admin'} зөвшөөрлөө.`
        : `Таны чөлөөний хүсэлтийг ${actingUser?.name || 'admin'} татгалзлаа.${comment ? ` Шалтгаан: ${comment}` : ''}`,
      type: 'leave_decision',
      relatedEntityType: 'leave_request',
      relatedEntityId: id,
      authorId: actingUserId,
    });

    // Also let every admin know who made the decision, so it's visible to
    // the whole admin team, not just the requesting CSR.
    if (isShiftLeave) {
      await createNotificationForAdmins({
        title: isApproved ? 'Яаралтай чөлөө зөвшөөрөгдлөө' : 'Яаралтай чөлөө татгалзагдлаа',
        content: `${request.user_name}-ийн ${displayDate(request.date)} ${displayTime(request.start_time)}-${displayTime(request.end_time)} ээлжийн чөлөөний хүсэлтийг ${actingUser?.name || 'admin'} ${isApproved ? 'зөвшөөрлөө' : 'татгалзлаа'}.`,
        type: 'leave_decision',
        relatedEntityType: 'leave_request',
        relatedEntityId: id,
        authorId: actingUserId,
      });
    }

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
    const request = await db('vacation_requests')
      .join('users', 'vacation_requests.user_id', '=', 'users.id')
      .where({ 'vacation_requests.id': id })
      .select('vacation_requests.*', 'users.name as user_name')
      .first();

    if (!request) {
      return res.status(404).json({ error: 'Хүсэлт олдсонгүй' });
    }

    await db('vacation_requests').where({ id }).update({
      status,
      approved_by: actingUserId,
      updated_at: db.fn.now(),
    });
    const isApproved = status === 'approved';

    await createNotificationForUser({
      userId: request.user_id,
      title: isApproved ? 'Амралтын хүсэлт зөвшөөрөгдлөө' : 'Амралтын хүсэлт татгалзагдлаа',
      content: isApproved
        ? `Таны амралтын хүсэлт (${displayDate(request.start_date)} - ${displayDate(request.end_date)}) зөвшөөрөгдлөө.`
        : `Таны амралтын хүсэлт (${displayDate(request.start_date)} - ${displayDate(request.end_date)}) татгалзагдлаа.`,
      type: 'vacation_decision',
      relatedEntityType: 'vacation_request',
      relatedEntityId: id,
      authorId: actingUserId,
    });

    res.json({ message: 'Амжилттай шинэчлэгдлээ' });
  } catch (err) {
    console.error('Update vacation request error:', err);
    res.status(500).json({ error: 'Хүсэлт шинэчлэхэд алдаа гарлаа' });
  }
});

export default router;
