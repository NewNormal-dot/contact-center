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

// Чөлөө is ONLY ever requested against a shift this CSR has actually
// booked, and only for hours that fall INSIDE that shift. There used to be
// a second, free-form path here (`type: 'daily' | 'hourly'` with a date the
// CSR typed in by hand) which let someone file leave for a day they were
// never scheduled to work at all - leave from nothing. That path is gone:
// no booking, no leave.
//
// Shared by creating a request and by editing one that is still pending, so
// the two can never drift apart on what counts as a valid window.
async function resolveLeaveWindow(params: {
  userId: string;
  bookingId: string;
  rawStartTime: unknown;
  rawEndTime: unknown;
  excludeLeaveId?: string;
}) {
  const booking = await db('slot_bookings')
    .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
    .where({ 'slot_bookings.id': params.bookingId })
    .select('slot_bookings.*', 'work_slots.date as slot_date', 'work_slots.start_time as slot_start_time', 'work_slots.end_time as slot_end_time')
    .first();

  if (!booking) return { status: 404, error: 'Захиалга олдсонгүй' } as const;
  if (booking.user_id !== params.userId) {
    return { status: 403, error: 'Энэ захиалга танд хамаарахгүй байна' } as const;
  }
  if (booking.status !== 'confirmed') {
    return { status: 400, error: 'Энэ захиалга идэвхгүй байна' } as const;
  }

  const shiftStartTime = toSqlTime(booking.slot_start_time);
  const shiftEndTime = toSqlTime(booking.slot_end_time);
  if (!shiftStartTime || !shiftEndTime) {
    return { status: 400, error: 'Ээлжийн цагийг тодорхойлж чадсангүй' } as const;
  }

  // A requested window defaults to the WHOLE shift - "I cannot work this
  // one at all" - which is by far the common case.
  const finalStartTime = toSqlTime(params.rawStartTime) || shiftStartTime;
  const finalEndTime = toSqlTime(params.rawEndTime) || shiftEndTime;

  // Night shifts run past midnight (22:00-06:00), so a plain string
  // comparison would reject every one of them. Measure everything as
  // minutes FROM the shift's own start instead, wrapping the end past
  // midnight when it lands before the start.
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const shiftStartMin = minutes(shiftStartTime);
  const fromShiftStart = (t: string) => {
    const delta = minutes(t) - shiftStartMin;
    return delta < 0 ? delta + 24 * 60 : delta;
  };
  const shiftLengthMin = fromShiftStart(shiftEndTime) || 24 * 60;
  const leaveFrom = fromShiftStart(finalStartTime);
  const leaveTo = minutes(finalEndTime) === minutes(shiftEndTime) ? shiftLengthMin : fromShiftStart(finalEndTime);

  // Bounds are checked BEFORE ordering: a time outside the shift wraps
  // past midnight in this arithmetic, which would otherwise surface as a
  // confusing "end before start" message.
  if (leaveFrom >= shiftLengthMin || leaveTo > shiftLengthMin) {
    return {
      status: 400,
      error: `Чөлөөний цаг ээлжийн хугацаанд (${displayTime(shiftStartTime)}-${displayTime(shiftEndTime)}) багтах ёстой`,
    } as const;
  }
  if (leaveTo <= leaveFrom) {
    return { status: 400, error: 'Дуусах цаг эхлэх цагаас хойш байх ёстой' } as const;
  }

  const shiftStart = toSqlDateTime(`${displayDate(booking.slot_date)}T${displayTime(shiftStartTime)}`);
  if (!shiftStart) return { status: 400, error: 'Ээлжийн цагийг тодорхойлж чадсангүй' } as const;

  const hoursUntilShift = (shiftStart.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntilShift < 8) {
    return {
      status: 400,
      error: hoursUntilShift < 0
        ? 'Энэ ээлж аль хэдийн эхэлсэн эсвэл өнгөрсөн байна'
        : `Ээлж эхлэхэд дор хаяж 8 цаг үлдсэн байх ёстой (одоогоор ${hoursUntilShift.toFixed(1)} цаг үлдсэн байна)`,
    } as const;
  }

  // One shift may carry more than one leave window (a CSR out for a
  // morning appointment and again in the afternoon), but two windows may
  // not overlap each other. When editing, the request being edited is not
  // its own clash.
  let existingQuery = db('leave_requests')
    .where({ slot_booking_id: params.bookingId })
    .whereIn('status', ['pending', 'approved']);
  if (params.excludeLeaveId) existingQuery = existingQuery.whereNot({ id: params.excludeLeaveId });
  const existingForBooking = await existingQuery.select('start_time', 'end_time');

  const clashes = existingForBooking.some((row: any) => {
    const rowStart = toSqlTime(row.start_time);
    const rowEnd = toSqlTime(row.end_time);
    if (!rowStart || !rowEnd) return true;
    const from = fromShiftStart(rowStart);
    const to = minutes(rowEnd) === minutes(shiftEndTime) ? shiftLengthMin : fromShiftStart(rowEnd);
    return from < leaveTo && to > leaveFrom;
  });
  if (clashes) {
    return { status: 409, error: 'Энэ ээлжийн тэр цагт аль хэдийн чөлөөний хүсэлт илгээгдсэн байна' } as const;
  }

  // Whole shift vs. part of it. The monthly export blanks out a whole day
  // for 'shift_leave' only, so a partial window must NOT be recorded as
  // one - it stays 'hourly'.
  const isWholeShift = leaveFrom === 0 && leaveTo === shiftLengthMin;

  return {
    booking,
    shiftStartTime,
    shiftEndTime,
    finalStartTime,
    finalEndTime,
    isWholeShift,
    leaveType: isWholeShift ? 'shift_leave' : 'hourly',
  };
}

function leaveReasonError(reason: unknown) {
  if (!reason || !String(reason).trim()) return 'Шалтгаанаа оруулна уу';
  if (String(reason).trim().length > 1000) return 'Шалтгаан хэт урт байна (1000 тэмдэгт)';
  return null;
}

router.post('/leave', authenticate, authorize(['csr']), async (req: any, res) => {
  const { start_time, end_time, startTime, endTime, reason, slotBookingId, slot_booking_id } = req.body;
  const userId = req.user.id;
  const requestedSlotBookingId = slotBookingId || slot_booking_id || null;

  if (!requestedSlotBookingId) {
    return res.status(400).json({ error: 'Чөлөө зөвхөн захиалсан ээлжийн цагт авах боломжтой. Ээлжээ сонгоно уу.' });
  }
  const reasonError = leaveReasonError(reason);
  if (reasonError) return res.status(400).json({ error: reasonError });

  try {
    const resolved = await resolveLeaveWindow({
      userId,
      bookingId: requestedSlotBookingId,
      rawStartTime: start_time || startTime,
      rawEndTime: end_time || endTime,
    });
    if ('error' in resolved) return res.status(resolved.status).json({ error: resolved.error });

    const { booking, shiftStartTime, shiftEndTime, finalStartTime, finalEndTime, isWholeShift, leaveType } = resolved;

    const id = uuidv4();
    const requestingUser = await db('users').where({ id: userId }).first();
    await db('leave_requests').insert({
      id,
      user_id: userId,
      slot_booking_id: requestedSlotBookingId,
      date: booking.slot_date,
      end_date: booking.slot_date,
      start_time: finalStartTime,
      end_time: finalEndTime,
      type: leaveType,
      reason,
      status: 'pending',
      // Snapshot so this record stays meaningful even if the account is
      // later deleted (user_id becomes NULL via SET NULL FK).
      user_name: requestingUser?.name,
      user_code: requestingUser?.code,
    });

    const window = `${displayTime(finalStartTime)}-${displayTime(finalEndTime)}`;
    await createNotificationForAdmins({
      title: isWholeShift ? 'Ээлжийн чөлөөний хүсэлт' : 'Цагийн чөлөөний хүсэлт',
      content: `${requestingUser?.name || 'CSR'} нь ${displayDate(booking.slot_date)} өдрийн ${displayTime(shiftStartTime)}-${displayTime(shiftEndTime)} ээлжийн ${isWholeShift ? 'бүтэн ээлжид' : `${window} цагт`} чөлөө хүссэн байна. Шалтгаан: ${reason}`,
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
      `${leaveType} leave requested for ${displayDate(booking.slot_date)} ${window} (shift ${displayTime(shiftStartTime)}-${displayTime(shiftEndTime)})`,
      req,
    );

    return res.status(201).json({ id });
  } catch (err) {
    console.error('Create leave request error:', err);
    captureError('requests: Create leave request error:', err);
    return res.status(500).json({ error: 'Чөлөөний хүсэлт үүсгэхэд алдаа гарлаа' });
  }
});

// A request nobody has answered yet is still the requester's to change or
// withdraw - previously it was fire-and-forget, and a CSR who picked the
// wrong shift or mistyped the hours had to ask an admin to reject it.
router.put('/leave/:id', authenticate, authorize(['csr']), async (req: any, res) => {
  const { id } = req.params;
  const { start_time, end_time, startTime, endTime, reason, slotBookingId, slot_booking_id } = req.body;
  const userId = req.user.id;

  const reasonError = leaveReasonError(reason);
  if (reasonError) return res.status(400).json({ error: reasonError });

  try {
    const existing = await db('leave_requests').where({ id }).first();
    if (!existing) return res.status(404).json({ error: 'Хүсэлт олдсонгүй' });
    if (String(existing.user_id) !== String(userId)) {
      return res.status(403).json({ error: 'Энэ хүсэлт танд хамаарахгүй байна' });
    }
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'Шийдвэрлэгдсэн хүсэлтийг засах боломжгүй' });
    }

    const targetBookingId = slotBookingId || slot_booking_id || existing.slot_booking_id;
    if (!targetBookingId) {
      return res.status(400).json({ error: 'Чөлөө зөвхөн захиалсан ээлжийн цагт авах боломжтой. Ээлжээ сонгоно уу.' });
    }

    const resolved = await resolveLeaveWindow({
      userId,
      bookingId: targetBookingId,
      rawStartTime: start_time || startTime,
      rawEndTime: end_time || endTime,
      excludeLeaveId: id,
    });
    if ('error' in resolved) return res.status(resolved.status).json({ error: resolved.error });

    const { booking, shiftStartTime, shiftEndTime, finalStartTime, finalEndTime, isWholeShift, leaveType } = resolved;

    // Guard the state machine: an admin may have decided the request while
    // this edit was in flight.
    const updated = await db('leave_requests')
      .where({ id, user_id: userId, status: 'pending' })
      .update({
        slot_booking_id: targetBookingId,
        date: booking.slot_date,
        end_date: booking.slot_date,
        start_time: finalStartTime,
        end_time: finalEndTime,
        type: leaveType,
        reason,
        updated_at: db.fn.now(),
      });
    if (updated !== 1) {
      return res.status(409).json({ error: 'Энэ хүсэлт аль хэдийн шийдвэрлэгдсэн байна' });
    }

    const window = `${displayTime(finalStartTime)}-${displayTime(finalEndTime)}`;
    const requestingUser = await db('users').where({ id: userId }).first();

    // Replace the admins' pending alert rather than adding a second one, so
    // the team sees the current request and not both versions of it.
    await db('notifications')
      .where({ related_entity_type: 'leave_request', related_entity_id: id })
      .whereIn('target_user_id', db('users').select('id').whereIn('role', ['admin', 'superadmin']))
      .del();
    await createNotificationForAdmins({
      title: 'Чөлөөний хүсэлт засагдлаа',
      content: `${requestingUser?.name || 'CSR'} нь ${displayDate(booking.slot_date)} өдрийн ${displayTime(shiftStartTime)}-${displayTime(shiftEndTime)} ээлжийн ${isWholeShift ? 'бүтэн ээлжид' : `${window} цагт`} чөлөө хүсэхээр хүсэлтээ өөрчиллөө. Шалтгаан: ${reason}`,
      type: 'leave_request',
      relatedEntityType: 'leave_request',
      relatedEntityId: id,
      authorId: userId,
    });

    await logAction(
      userId,
      'UPDATE_LEAVE_REQUEST',
      'leave_requests',
      id,
      `edited to ${leaveType} ${displayDate(booking.slot_date)} ${window}`,
      req,
    );

    return res.json({ id });
  } catch (err) {
    console.error('Update own leave request error:', err);
    captureError('requests: Update own leave request error:', err);
    return res.status(500).json({ error: 'Чөлөөний хүсэлт засахад алдаа гарлаа' });
  }
});

router.delete('/leave/:id', authenticate, authorize(['csr']), async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const existing = await db('leave_requests').where({ id }).first();
    if (!existing) return res.status(404).json({ error: 'Хүсэлт олдсонгүй' });
    if (String(existing.user_id) !== String(userId)) {
      return res.status(403).json({ error: 'Энэ хүсэлт танд хамаарахгүй байна' });
    }
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'Шийдвэрлэгдсэн хүсэлтийг устгах боломжгүй' });
    }

    const removed = await db.transaction(async (trx) => {
      const count = await trx('leave_requests').where({ id, user_id: userId, status: 'pending' }).del();
      if (count !== 1) return false;
      // The admins' "хүсэлт ирлээ" alerts point at a request that no longer
      // exists, so they go with it.
      await trx('notifications')
        .where({ related_entity_type: 'leave_request', related_entity_id: id })
        .del();
      return true;
    });

    if (!removed) {
      return res.status(409).json({ error: 'Энэ хүсэлт аль хэдийн шийдвэрлэгдсэн байна' });
    }

    await logAction(
      userId,
      'DELETE_LEAVE_REQUEST',
      'leave_requests',
      id,
      `withdrew ${existing.type || 'hourly'} leave for ${displayDate(existing.date)} ${displayTime(existing.start_time)}-${displayTime(existing.end_time)}`,
      req,
    );

    return res.json({ message: 'Хүсэлт устгагдлаа' });
  } catch (err) {
    console.error('Delete own leave request error:', err);
    captureError('requests: Delete own leave request error:', err);
    return res.status(500).json({ error: 'Чөлөөний хүсэлт устгахад алдаа гарлаа' });
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

      // Let the whole admin team see who approved or rejected the request,
      // regardless of whether it was an urgent shift leave or a standard
      // daily/hourly leave request. The requester still gets a personal
      // decision notice, but no other CSR should receive any copy of this
      // admin-facing decision trail.
      const decisionTitle = isApproved ? 'Чөлөөний хүсэлт зөвшөөрөгдлөө' : 'Чөлөөний хүсэлт татгалзагдлаа';
      const requestKind = isShiftLeave
        ? `${displayDate(request.date)} ${displayTime(request.start_time)}-${displayTime(request.end_time)} ээлжийн`
        : request.type === 'daily'
          ? 'өдрийн'
          : 'цагийн';

      await createNotificationForAdmins({
        title: decisionTitle,
        content: `${request.user_name || 'CSR'}-ийн ${requestKind} чөлөөний хүсэлтийг ${actingUser?.name || 'admin'} ${isApproved ? 'зөвшөөрлөө' : 'татгалзлаа'}.`,
        type: 'leave_decision',
        relatedEntityType: 'leave_request',
        relatedEntityId: id,
        authorId: actingUserId,
      }, trx);

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
