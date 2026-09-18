import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { toSqlDate, toSqlTime, toSqlDateTime, displayDate, displayTime } from '../utils/sqlDate';
import { captureError } from '../utils/errorLog';
import { logAction } from './audit';

const router = express.Router();

// Mongolia is UTC+8 and does not observe DST. Azure App Service runs in UTC,
// so `new Date().getFullYear()` &c on the server are a calendar day BEHIND
// the user between 00:00 and 08:00 local - which is exactly when a night
// shift files a request. Always derive "today" from the Mongolian wall clock.
const ULAANBAATAR_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
export function todayInMongolia() {
  return new Date(Date.now() + ULAANBAATAR_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

async function createNotificationForUser(params: {
  userId: string;
  title: string;
  content: string;
  type: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  authorId?: string;
}, trx: any = db) {
  await trx('notifications').insert({
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
}, trx: any = db) {
  // Superadmins were excluded here while the resolution step below deletes
  // notifications for BOTH roles - so a superadmin never saw a leave request
  // arrive but their (never-created) copy was dutifully cleaned up.
  const admins = await trx('users')
    .whereIn('role', ['admin', 'superadmin'])
    .where({ status: 'active' })
    .select('id');

  if (admins.length === 0) return;

  await trx('notifications').insert(
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
      .leftJoin('users', 'leave_requests.user_id', '=', 'users.id')
      .leftJoin('users as approvers', 'leave_requests.approved_by', '=', 'approvers.id')
      .select(
        'leave_requests.id',
        'leave_requests.user_id',
        'leave_requests.date',
        'leave_requests.end_date',
        'leave_requests.start_time',
        'leave_requests.end_time',
        'leave_requests.reason',
        'leave_requests.status',
        'leave_requests.approved_by',
        'leave_requests.created_at',
        'leave_requests.updated_at',
        'leave_requests.type',
        'leave_requests.comment',
        'leave_requests.slot_booking_id',
        // Prefer the live users table, falling back to the snapshot stored
        // on the request itself if the user account was deleted - keeps
        // historical leave records meaningful after account removal.
        db.raw('COALESCE(users.name, leave_requests.user_name) as user_name'),
        'approvers.name as approver_name',
      );

    if (role === 'csr') query = query.where({ 'leave_requests.user_id': id });

    // Qualify the table: `created_at` exists on leave_requests AND on both
    // joined copies of `users`, so an unqualified reference is ambiguous.
    const requests = await query.orderBy('leave_requests.created_at', 'desc');
    res.json(requests.map(mapLeave));
  } catch (err) {
    console.error('Get leave requests error:', err);
    captureError('requests: Get leave requests error:', err);
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

      const shiftStart = toSqlDateTime(`${displayDate(booking.slot_date)}T${displayTime(booking.slot_start_time)}`);
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
      const requestingUser = await db('users').where({ id: userId }).first();
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
        // Snapshot so this record stays meaningful even if the account is
        // later deleted (user_id becomes NULL via SET NULL FK).
        user_name: requestingUser?.name,
        user_code: requestingUser?.code,
      });

      const user = requestingUser;
      await createNotificationForAdmins({
        title: 'Яаралтай чөлөөний хүсэлт',
        content: `${user?.name || 'CSR'} нь ${displayDate(booking.slot_date)} өдрийн ${displayTime(booking.slot_start_time)}-${displayTime(booking.slot_end_time)} ээлжинд яаралтай чөлөө хүссэн байна. Шалтгаан: ${reason}`,
        type: 'leave_request',
        relatedEntityType: 'leave_request',
        relatedEntityId: id,
        authorId: userId,
      });

      await logAction(
        userId,
        'CREATE_SHIFT_LEAVE_REQUEST',
        'leave_requests',
        id,
        `Urgent leave requested for ${displayDate(booking.slot_date)} ${displayTime(booking.slot_start_time)}-${displayTime(booking.slot_end_time)}`,
        req,
      );

      return res.status(201).json({ id });
    } catch (err) {
      console.error('Create shift leave request error:', err);
    captureError('requests: Create shift leave request error:', err);
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

  if (String(reason).trim().length > 1000) {
    return res.status(400).json({ error: 'Шалтгаан хэт урт байна (1000 тэмдэгт)' });
  }

  // Everything below was previously unchecked: only the FORMAT of the date
  // and times was validated, so a CSR could file leave for last year, with
  // an end time before the start time, an end date before the start date,
  // and as many identical overlapping requests as they liked.
  if (finalEndDate && finalEndDate < finalDate) {
    return res.status(400).json({ error: 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй' });
  }

  if (finalDate < todayInMongolia()) {
    return res.status(400).json({ error: 'Өнгөрсөн өдрийн чөлөө хүсэх боломжгүй' });
  }

  if (leaveType === 'hourly' && finalEndTime <= finalStartTime) {
    return res.status(400).json({ error: 'Дуусах цаг эхлэх цагаас хойш байх ёстой' });
  }

  try {
    const id = uuidv4();
    const requestingUser = await db('users').where({ id: userId }).first();

    // Reject a request that overlaps one this CSR already has open or
    // approved for the same dates.
    const overlapping = await db('leave_requests')
      .where({ user_id: userId })
      .whereIn('status', ['pending', 'approved'])
      .andWhere(function () {
        this.where(function () {
          this.where('date', '<=', finalEndDate || finalDate)
            .andWhere(db.raw('COALESCE(end_date, date)'), '>=', finalDate);
        });
      })
      .first();

    if (overlapping) {
      return res.status(409).json({
        error: `Энэ хугацаанд аль хэдийн чөлөөний хүсэлт (${overlapping.status === 'approved' ? 'зөвшөөрөгдсөн' : 'хүлээгдэж буй'}) байна.`,
      });
    }

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
      user_name: requestingUser?.name,
      user_code: requestingUser?.code,
    });

    const user = requestingUser;

    await createNotificationForAdmins({
      title: 'Шинэ чөлөөний хүсэлт',
      content: `${user?.name || 'CSR'} ${leaveType === 'daily' ? 'өдрийн' : 'цагийн'} чөлөө хүссэн байна. Огноо: ${finalDate}${leaveType === 'daily' && finalEndDate && finalEndDate !== finalDate ? ` - ${finalEndDate}` : ''}.`,
      type: 'leave_request',
      relatedEntityType: 'leave_request',
      relatedEntityId: id,
      authorId: userId,
    });

    await logAction(
      userId,
      'CREATE_LEAVE_REQUEST',
      'leave_requests',
      id,
      `${leaveType} leave requested for ${finalDate}${finalEndDate && finalEndDate !== finalDate ? ` - ${finalEndDate}` : ''}`,
      req,
    );

    res.status(201).json({ id });
  } catch (err) {
    console.error('Create leave request error:', err);
    captureError('requests: Create leave request error:', err);
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
  if (comment !== undefined && comment !== null && String(comment).length > 1000) {
    return res.status(400).json({ error: 'Тайлбар хэт урт байна (1000 тэмдэгт)' });
  }

  try {
    // LEFT join, not an inner join. leave_requests.user_id becomes NULL when
    // the employee is deleted (ON DELETE SET NULL, deliberately, so the
    // history survives). With an inner join the row was still LISTED by
    // GET /leave - which does use a left join - but could not be found here,
    // so the admin saw a request they were simply unable to action and got
    // 404 "Хүсэлт олдсонгүй".
    const request = await db('leave_requests')
      .leftJoin('users', 'leave_requests.user_id', '=', 'users.id')
      .where({ 'leave_requests.id': id })
      .select(
        'leave_requests.*',
        db.raw('COALESCE(users.name, leave_requests.user_name) as user_name'),
      )
      .first();

    if (!request) {
      return res.status(404).json({ error: 'Хүсэлт олдсонгүй' });
    }

    // Deliberately does NOT touch slot_bookings at all - the booking stays
    // exactly as 'confirmed'. Booking is already closed for a published
    // schedule, so this seat is not meant to be reassigned to anyone else;
    // approving urgent leave just excuses this person from working it
    // (reflected in exports/reports), without freeing capacity for others.

    // The whole decision - status, the stale admin alerts, and the
    // notifications it produces - is now one transaction. Previously the
    // status was committed first and a later notification failure returned
    // 500, so the admin saw "error" for an approval that had in fact gone
    // through, retried, and (with no state guard) approved it a second time.
    const outcome = await db.transaction(async (trx) => {
      // Guard the state machine. Without this an already-decided request
      // could be decided again and again: approved_by was overwritten and
      // the CSR was re-notified every time.
      const updated = await trx('leave_requests')
        .where({ id, status: 'pending' })
        .update({
          status,
          comment: comment || null,
          approved_by: actingUserId,
          updated_at: trx.fn.now(),
        });

      if (updated !== 1) return { conflict: true as const };

      // Clear the original "хүсэлт ирлээ" notifications that were sent to
      // every admin when this request was created - now that it's resolved,
      // those stale pending-alerts should stop showing for admins who didn't
      // act on it. The CSR's own copy (if any) is untouched.
      await trx('notifications')
        .where({ related_entity_type: 'leave_request', related_entity_id: id })
        .whereIn('target_user_id', trx('users').select('id').whereIn('role', ['admin', 'superadmin']))
        .del();

      const isApproved = status === 'approved';
      const actingUser = await trx('users').where({ id: actingUserId }).first();
      const isShiftLeave = request.type === 'shift_leave';

      // A deleted requester has no account left to notify.
      if (request.user_id) {
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
        }, trx);
      }

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
        }, trx);
      }

      return { conflict: false as const };
    });

    if (outcome.conflict) {
      const current = await db('leave_requests').where({ id }).first();
      return res.status(409).json({
        error: current?.status === 'approved'
          ? 'Энэ хүсэлтийг аль хэдийн зөвшөөрсөн байна.'
          : current?.status === 'rejected'
            ? 'Энэ хүсэлтийг аль хэдийн татгалзсан байна.'
            : 'Хүсэлтийн төлөв өөрчлөгдсөн байна.',
        status: current?.status,
      });
    }

    await logAction(
      actingUserId,
      status === 'approved' ? 'APPROVE_LEAVE_REQUEST' : 'REJECT_LEAVE_REQUEST',
      'leave_requests',
      id,
      `${status} ${request.type || 'hourly'} leave for ${request.user_name || 'deleted user'} (${displayDate(request.date)})`,
      req,
    );

    res.json({ message: 'Амжилттай шинэчлэгдлээ' });
  } catch (err) {
    console.error('Update leave request error:', err);
    captureError('requests: Update leave request error:', err);
    res.status(500).json({ error: 'Хүсэлт шинэчлэхэд алдаа гарлаа' });
  }
});

router.get('/vacation', authenticate, async (req: any, res) => {
  const { role, id } = req.user;
  try {
    // LEFT join: vacation_requests.user_id is CASCADE-deleted today, but an
    // inner join also hid any row whose user was merely being removed, and
    // it is the same trap the leave endpoints fell into.
    let query = db('vacation_requests')
      .leftJoin('users', 'vacation_requests.user_id', '=', 'users.id')
      .select('vacation_requests.*', 'users.name as user_name');

    if (role === 'csr') query = query.where({ 'vacation_requests.user_id': id });

    // Qualify the table: `users` is joined and also has a `created_at`.
    const requests = await query.orderBy('vacation_requests.created_at', 'desc');
    res.json(requests.map(mapVacation));
  } catch (err) {
    console.error('Get vacation requests error:', err);
    captureError('requests: Get vacation requests error:', err);
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
  if (String(reason).trim().length > 1000) {
    return res.status(400).json({ error: 'Шалтгаан хэт урт байна (1000 тэмдэгт)' });
  }
  // Was entirely unchecked: an end date before the start date, and leave in
  // the past, were both accepted.
  if (finalEndDate < finalStartDate) {
    return res.status(400).json({ error: 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй' });
  }
  if (finalStartDate < todayInMongolia()) {
    return res.status(400).json({ error: 'Өнгөрсөн өдрөөр амралт хүсэх боломжгүй' });
  }

  try {
    const overlapping = await db('vacation_requests')
      .where({ user_id: userId })
      .whereIn('status', ['pending', 'approved'])
      .andWhere('start_date', '<=', finalEndDate)
      .andWhere('end_date', '>=', finalStartDate)
      .first();
    if (overlapping) {
      return res.status(409).json({ error: 'Энэ хугацаанд аль хэдийн амралтын хүсэлт байна.' });
    }

    const id = uuidv4();
    const requestingUser = await db('users').where({ id: userId }).first();
    await db('vacation_requests').insert({
      id,
      user_id: userId,
      start_date: finalStartDate,
      end_date: finalEndDate,
      reason,
      status: 'pending',
    });

    // No notification was created at all here, while PATCH below dutifully
    // deleted the admin alerts that had never existed - so admins were
    // simply never told a vacation request had arrived.
    await createNotificationForAdmins({
      title: 'Шинэ амралтын хүсэлт',
      content: `${requestingUser?.name || 'CSR'} ${finalStartDate} - ${finalEndDate} хооронд амралт хүссэн байна.`,
      type: 'vacation_request',
      relatedEntityType: 'vacation_request',
      relatedEntityId: id,
      authorId: userId,
    });

    await logAction(
      userId,
      'CREATE_VACATION_REQUEST',
      'vacation_requests',
      id,
      `Vacation requested ${finalStartDate} - ${finalEndDate}`,
      req,
    );

    res.status(201).json({ id });
  } catch (err) {
    console.error('Create vacation request error:', err);
    captureError('requests: Create vacation request error:', err);
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
      .leftJoin('users', 'vacation_requests.user_id', '=', 'users.id')
      .where({ 'vacation_requests.id': id })
      .select('vacation_requests.*', 'users.name as user_name')
      .first();

    if (!request) {
      return res.status(404).json({ error: 'Хүсэлт олдсонгүй' });
    }

    const outcome = await db.transaction(async (trx) => {
      const updated = await trx('vacation_requests')
        .where({ id, status: 'pending' })
        .update({ status, approved_by: actingUserId, updated_at: trx.fn.now() });
      if (updated !== 1) return { conflict: true as const };

      await trx('notifications')
        .where({ related_entity_type: 'vacation_request', related_entity_id: id })
        .whereIn('target_user_id', trx('users').select('id').whereIn('role', ['admin', 'superadmin']))
        .del();

      if (request.user_id) {
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
        }, trx);
      }

      return { conflict: false as const };
    });

    if (outcome.conflict) {
      const current = await db('vacation_requests').where({ id }).first();
      return res.status(409).json({
        error: 'Энэ хүсэлтийг аль хэдийн шийдвэрлэсэн байна.',
        status: current?.status,
      });
    }

    await logAction(
      actingUserId,
      status === 'approved' ? 'APPROVE_VACATION_REQUEST' : 'REJECT_VACATION_REQUEST',
      'vacation_requests',
      id,
      `${status} vacation for ${request.user_name || 'deleted user'} (${displayDate(request.start_date)} - ${displayDate(request.end_date)})`,
      req,
    );

    res.json({ message: 'Амжилттай шинэчлэгдлээ' });
  } catch (err) {
    console.error('Update vacation request error:', err);
    captureError('requests: Update vacation request error:', err);
    res.status(500).json({ error: 'Хүсэлт шинэчлэхэд алдаа гарлаа' });
  }
});

export default router;
