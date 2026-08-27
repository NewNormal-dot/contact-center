import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { logAction } from './audit';
import { displayDate, displayTime } from '../utils/sqlDate';
import { captureError } from '../utils/errorLog';

const router = express.Router();

function normalizeEmploymentType(value: unknown) {
  return String(value || 'Full Time').trim() === 'Part Time' ? 'Part Time' : 'Full Time';
}

function normalizeSegment(value: unknown) {
  // No "All" wildcard - segments are fully separate business units.
  return String(value || '').trim();
}

function normalizeLocation(value: unknown) {
  return String(value || 'Ulaanbaatar').trim() === 'Darkhan' ? 'Darkhan' : 'Ulaanbaatar';
}

function timeToMinutes(value: string) {
  const [h, m] = String(value || '00:00').split(':').map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function minutesToSqlTime(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function slotTimeLabel(slot: any) {
  if (slot?.is_rest) return 'Амралт';
  return `${displayTime(slot.start_time)}-${displayTime(slot.end_time)}`;
}

async function createNotification(payload: { title: string; content: string; authorId?: string | null; targetUserId?: string | null; relatedEntityType?: string; relatedEntityId?: string; type?: string }, trx: any = db) {
  await trx('notifications').insert({
    id: uuidv4(),
    title: payload.title,
    content: payload.content,
    author_id: payload.authorId || null,
    target_user_id: payload.targetUserId || null,
    related_entity_type: payload.relatedEntityType || null,
    related_entity_id: payload.relatedEntityId || null,
    type: payload.type || 'general',
  });
}

// Admins see trade activity for oversight (no action needed - see the
// /respond handler), as ONE evolving notification per trade rather than a
// stack of separate "received/approved/declined" rows. Each admin gets
// their own row (matches the createNotificationForAdmins pattern used for
// leave requests) so it never leaks into a CSR's notification feed; the
// SAME rows get updated in place as the trade's status changes.
async function upsertAdminTradeNotification(tradeId: string, title: string, content: string, trx: any = db) {
  const admins = await trx('users').where({ role: 'admin', status: 'active' }).select('id');
  if (admins.length === 0) return;
  const adminIds = admins.map((a: any) => a.id);
  const existing = await trx('notifications')
    .where({ related_entity_type: 'trade_requests', related_entity_id: tradeId })
    .whereIn('target_user_id', adminIds)
    .select('id', 'target_user_id');
  const existingByTarget = new Map(existing.map((row: any) => [row.target_user_id, row.id]));

  for (const adminId of adminIds) {
    const existingId = existingByTarget.get(adminId);
    if (existingId) {
      await trx('notifications').where({ id: existingId }).update({
        title,
        content,
        type: 'important',
        updated_at: trx.fn.now(),
      });
    } else {
      await trx('notifications').insert({
        id: uuidv4(),
        title,
        content,
        type: 'important',
        target_user_id: adminId,
        related_entity_type: 'trade_requests',
        related_entity_id: tradeId,
        author_id: null,
      });
    }
  }
}

function tradeShiftDesc(slot: any) {
  return `${displayDate(slot.date)} ${slotTimeLabel(slot)}`;
}

function mapTrade(row: any) {
  return {
    id: row.id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    receiverId: row.receiver_id,
    receiverName: row.receiver_name,
    senderSlotId: row.sender_slot_id,
    receiverSlotId: row.receiver_slot_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedBy: row.approved_by,
    senderDate: displayDate(row.sender_date),
    receiverDate: displayDate(row.receiver_date),
    senderShiftTime: row.sender_is_rest ? 'Амралт' : `${displayTime(row.sender_start)}-${displayTime(row.sender_end)}`,
    receiverShiftTime: row.receiver_is_rest ? 'Амралт' : `${displayTime(row.receiver_start)}-${displayTime(row.receiver_end)}`,
    senderDuration: Number(row.sender_duration || 0),
    receiverDuration: Number(row.receiver_duration || 0),
    senderSegment: row.sender_segment,
    receiverSegment: row.receiver_segment,
    senderEmploymentType: row.sender_employment_type,
    receiverEmploymentType: row.receiver_employment_type,
  };
}

function baseTradeQuery(trx: any = db) {
  return trx('trade_requests')
    .join('users as sender', 'trade_requests.sender_id', '=', 'sender.id')
    .join('users as receiver', 'trade_requests.receiver_id', '=', 'receiver.id')
    .join('work_slots as sender_slot', 'trade_requests.sender_slot_id', '=', 'sender_slot.id')
    .join('work_slots as receiver_slot', 'trade_requests.receiver_slot_id', '=', 'receiver_slot.id')
    .select(
      'trade_requests.*',
      'sender.name as sender_name',
      'sender.email as sender_email',
      'receiver.name as receiver_name',
      'receiver.email as receiver_email',
      'sender.segment as sender_segment',
      'receiver.segment as receiver_segment',
      'sender.employment_type as sender_employment_type',
      'receiver.employment_type as receiver_employment_type',
      'sender_slot.date as sender_date',
      'sender_slot.start_time as sender_start',
      'sender_slot.end_time as sender_end',
      'sender_slot.duration as sender_duration',
      'sender_slot.is_rest as sender_is_rest',
      'receiver_slot.date as receiver_date',
      'receiver_slot.start_time as receiver_start',
      'receiver_slot.end_time as receiver_end',
      'receiver_slot.duration as receiver_duration',
      'receiver_slot.is_rest as receiver_is_rest',
    );
}

function todayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// A pending trade that never got a response is auto-declined once either
// shift date it involves has arrived (00:00 that day) - past that point the
// swap no longer makes sense for the earlier of the two shifts, so there's
// nothing left to approve. Runs opportunistically whenever trades are
// listed (both CSR and admin dashboards poll this route).
async function autoDeclineExpiredTrades() {
  const today = todayDateKey();
  const expired = await baseTradeQuery()
    .where('trade_requests.status', 'pending')
    .where(function () {
      this.where('sender_slot.date', '<', today).orWhere('receiver_slot.date', '<', today);
    });

  for (const trade of expired) {
    const updated = await db('trade_requests')
      .where({ id: trade.id, status: 'pending' })
      .update({ status: 'rejected', updated_at: db.fn.now() });
    if (!updated) continue;

    await createNotification({
      title: 'Trade хүсэлтэд хариу ирээгүй',
      content: `Таны trade хүсэлтэд хугацаанд нь хариу ирээгүй тул автоматаар цуцлагдлаа.`,
      targetUserId: trade.sender_id,
      relatedEntityType: 'trade_requests',
      relatedEntityId: trade.id,
      type: 'important',
    });

    const senderSlotView = { date: trade.sender_date, is_rest: trade.sender_is_rest, start_time: trade.sender_start, end_time: trade.sender_end };
    const receiverSlotView = { date: trade.receiver_date, is_rest: trade.receiver_is_rest, start_time: trade.receiver_start, end_time: trade.receiver_end };
    await upsertAdminTradeNotification(
      trade.id,
      'Ээлж солих хүсэлт',
      `Хүсэлт илгээгч ${trade.sender_name} ${tradeShiftDesc(senderSlotView)} ээлжээрээ ажиллах хэвээр, хүсэлт хүлээн авагч ${trade.receiver_name} ${tradeShiftDesc(receiverSlotView)}-тай хуваартайгаа үлдлээ. Хариу өгөөгүй тул автоматаар цуцлагдлаа.`,
    );
  }
}

router.get('/', authenticate, async (req: any, res) => {
  try {
    await autoDeclineExpiredTrades();
    let query = baseTradeQuery();
    if (req.user.role === 'csr') {
      query = query.where(function () {
        this.where('sender_id', req.user.id).orWhere('receiver_id', req.user.id);
      });
    }
    const rows = await query.orderBy('trade_requests.created_at', 'desc');
    res.json(rows.map(mapTrade));
  } catch (err) {
    console.error('Get trades error:', err);
    captureError('trades: Get trades error:', err);
    res.status(500).json({ error: 'Арилжааны хүсэлт татахад алдаа гарлаа' });
  }
});

router.post('/', authenticate, authorize(['csr']), async (req: any, res) => {
  const { receiver_id, receiverId, sender_slot_id, senderSlotId, receiver_slot_id, receiverSlotId } = req.body;
  const senderId = req.user.id;
  const receiverIdFinal = receiver_id || receiverId;
  const senderSlotIdFinal = sender_slot_id || senderSlotId;
  const receiverSlotIdFinal = receiver_slot_id || receiverSlotId;

  if (!receiverIdFinal || !senderSlotIdFinal || !receiverSlotIdFinal) {
    return res.status(400).json({ error: 'Солих хэрэглэгч болон ээлжийн мэдээлэл шаардлагатай' });
  }
  if (receiverIdFinal === senderId) return res.status(400).json({ error: 'Өөртэйгөө ээлж солих боломжгүй' });

  try {
    const sender = await db('users').where({ id: senderId }).first();
    const receiver = await db('users').where({ id: receiverIdFinal }).first();
    if (!sender || !receiver) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    const senderSegment = normalizeSegment(sender.segment);
    const receiverSegment = normalizeSegment(receiver.segment);
    if (!senderSegment || !receiverSegment) {
      return res.status(400).json({ error: 'Хэрэглэгчийн segment тодорхойгүй байна' });
    }
    if (senderSegment !== receiverSegment) {
      return res.status(400).json({ error: 'Зөвхөн ижил segment-ийн CSR хооронд trade хийх боломжтой' });
    }
    if (normalizeEmploymentType(sender.employment_type) !== normalizeEmploymentType(receiver.employment_type)) {
      return res.status(400).json({ error: 'Full Time нь Full Time-тай, Part Time нь Part Time-тай trade хийнэ' });
    }
    if (normalizeLocation(sender.location) !== normalizeLocation(receiver.location)) {
      return res.status(400).json({ error: 'Зөвхөн ижил байршлын (location) CSR хооронд trade хийх боломжтой' });
    }

    const senderBooking = await db('slot_bookings').where({ user_id: senderId, slot_id: senderSlotIdFinal, status: 'confirmed' }).first();
    const receiverBooking = await db('slot_bookings').where({ user_id: receiverIdFinal, slot_id: receiverSlotIdFinal, status: 'confirmed' }).first();
    if (!senderBooking || !receiverBooking) return res.status(400).json({ error: 'Захиалга баталгаагүй байна' });

    const senderSlot = await db('work_slots').where({ id: senderSlotIdFinal }).first();
    const receiverSlot = await db('work_slots').where({ id: receiverSlotIdFinal }).first();
    if (!senderSlot || !receiverSlot) return res.status(404).json({ error: 'Солих ээлж олдсонгүй' });

    const id = uuidv4();
    await db('trade_requests').insert({
      id,
      sender_id: senderId,
      receiver_id: receiverIdFinal,
      sender_slot_id: senderSlotIdFinal,
      receiver_slot_id: receiverSlotIdFinal,
      status: 'pending',
    });

    await createNotification({
      title: 'Ээлж солих хүсэлт ирлээ',
      content: `${sender.name} танд ${displayDate(senderSlot.date)} ${slotTimeLabel(senderSlot)} ээлжээ ${displayDate(receiverSlot.date)} ${slotTimeLabel(receiverSlot)} ээлжтэй солих хүсэлт илгээлээ.`,
      authorId: senderId,
      targetUserId: receiverIdFinal,
      relatedEntityType: 'trade_requests',
      relatedEntityId: id,
      type: 'important',
    });

    await upsertAdminTradeNotification(
      id,
      'Ээлж солих хүсэлт',
      `Хүсэлт илгээгч ${sender.name} ${tradeShiftDesc(senderSlot)}-ийн хүсэлтийг, хүлээн авагч ${receiver.name} ${tradeShiftDesc(receiverSlot)}-тай солихоор санал болгож байна.`,
    );

    res.status(201).json({ id });
  } catch (err) {
    console.error('Create trade error:', err);
    captureError('trades: Create trade error:', err);
    res.status(500).json({ error: 'Арилжааны хүсэлт үүсгэхэд алдаа гарлаа' });
  }
});

router.patch('/:id/respond', authenticate, authorize(['csr']), async (req: any, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'Хариуны төлөв буруу байна' });

  if (status === 'rejected') {
    try {
      const trade = await baseTradeQuery().where('trade_requests.id', id).first();
      if (!trade || trade.receiver_id !== req.user.id) return res.status(404).json({ error: 'Арилжааны хүсэлт олдсонгүй' });
      if (trade.status !== 'pending') return res.status(400).json({ error: 'Зөвхөн хүлээгдэж буй хүсэлтэд хариу өгнө' });

      await db('trade_requests').where({ id }).update({ status: 'rejected', receiver_responded_at: db.fn.now(), updated_at: db.fn.now() });
      await createNotification({
        title: 'Trade хүсэлт татгалзлаа',
        content: `${trade.receiver_name} таны trade хүсэлтээс татгалзлаа.`,
        authorId: req.user.id,
        targetUserId: trade.sender_id,
        relatedEntityType: 'trade_requests',
        relatedEntityId: id,
        type: 'important',
      });
      await upsertAdminTradeNotification(
        id,
        'Ээлж солих хүсэлт',
        `Хүсэлт илгээгч ${trade.sender_name} ${tradeShiftDesc({ date: trade.sender_date, is_rest: trade.sender_is_rest, start_time: trade.sender_start, end_time: trade.sender_end })} ээлжээрээ ажиллах хэвээр, хүсэлт хүлээн авагч ${trade.receiver_name} ${tradeShiftDesc({ date: trade.receiver_date, is_rest: trade.receiver_is_rest, start_time: trade.receiver_start, end_time: trade.receiver_end })}-тай хуваартайгаа үлдлээ.`,
      );
      return res.json({ message: 'Амжилттай хариу илгээлээ' });
    } catch (err) {
      console.error('Respond trade error:', err);
      captureError('trades: Respond trade error:', err);
      return res.status(500).json({ error: 'Trade хүсэлтэд хариу өгөхөд алдаа гарлаа' });
    }
  }

  // status === 'accepted': the receiver accepting immediately finalizes the
  // trade between the two CSRs - no admin approval step, no admin-facing
  // notification. The slot swap happens atomically right here, and an
  // audit log entry (timestamp, segment, both users' emails) is recorded
  // instead. See findOrCreateAdjustedSlot below for the swap mechanics.
  const trx = await db.transaction();
  try {
    const trade = await baseTradeQuery(trx).where('trade_requests.id', id).first();
    if (!trade || trade.receiver_id !== req.user.id) {
      await trx.rollback();
      return res.status(404).json({ error: 'Арилжааны хүсэлт олдсонгүй' });
    }
    if (trade.status !== 'pending') {
      await trx.rollback();
      return res.status(400).json({ error: 'Зөвхөн хүлээгдэж буй хүсэлтэд хариу өгнө' });
    }

    const senderSlot = await trx('work_slots').where({ id: trade.sender_slot_id }).first();
    const receiverSlot = await trx('work_slots').where({ id: trade.receiver_slot_id }).first();
    if (!senderSlot || !receiverSlot) throw new Error('Missing slots');

    const senderNewSlot = await findOrCreateAdjustedSlot(trx, { ...receiverSlot, segment: senderSlot.segment, employment_type: senderSlot.employment_type }, displayDate(receiverSlot.date), Number(senderSlot.duration), 'end');
    const receiverNewSlot = await findOrCreateAdjustedSlot(trx, { ...senderSlot, segment: receiverSlot.segment, employment_type: receiverSlot.employment_type }, displayDate(senderSlot.date), Number(receiverSlot.duration), 'start');

    const senderBooking = await trx('slot_bookings').where({ user_id: trade.sender_id, slot_id: trade.sender_slot_id, status: 'confirmed' }).first();
    const receiverBooking = await trx('slot_bookings').where({ user_id: trade.receiver_id, slot_id: trade.receiver_slot_id, status: 'confirmed' }).first();
    if (!senderBooking || !receiverBooking) throw new Error('Bookings are no longer available');

    await trx('slot_bookings').where({ id: senderBooking.id }).update({ slot_id: senderNewSlot.id, booked_at: trx.fn.now() });
    await trx('slot_bookings').where({ id: receiverBooking.id }).update({ slot_id: receiverNewSlot.id, booked_at: trx.fn.now() });

    const tradeUpdated = await trx('trade_requests')
      .where({ id, status: 'pending' })
      .update({ status: 'approved', receiver_responded_at: trx.fn.now(), admin_decided_at: trx.fn.now(), updated_at: trx.fn.now() });

    if (tradeUpdated !== 1) {
      await trx.rollback();
      return res.status(409).json({ error: 'Арилжааны төлөв өөрчлөгдсөн байна' });
    }

    await createNotification({ title: 'Ээлж амжилттай солигдлоо', content: `Таны шинэ хуваарь: ${displayDate(senderNewSlot.date)} ${slotTimeLabel(senderNewSlot)}.`, authorId: req.user.id, targetUserId: trade.sender_id, relatedEntityType: 'trade_requests', relatedEntityId: id, type: 'important' }, trx);
    await createNotification({ title: 'Ээлж амжилттай солигдлоо', content: `Таны шинэ хуваарь: ${displayDate(receiverNewSlot.date)} ${slotTimeLabel(receiverNewSlot)}.`, authorId: req.user.id, targetUserId: trade.receiver_id, relatedEntityType: 'trade_requests', relatedEntityId: id, type: 'important' }, trx);
    await upsertAdminTradeNotification(
      id,
      'Ээлж солих хүсэлт',
      `${trade.sender_name} одоо ${tradeShiftDesc(senderNewSlot)} ажиллана, ${trade.receiver_name} одоо ${tradeShiftDesc(receiverNewSlot)} ажиллана.`,
      trx,
    );

    await trx.commit();

    await logAction(
      req.user.id,
      'TRADE_COMPLETED',
      'trade_requests',
      id,
      `${trade.sender_name} (${trade.sender_email}) <-> ${trade.receiver_name} (${trade.receiver_email}) | segment: ${trade.sender_segment} | ${displayDate(senderSlot.date)} ${slotTimeLabel(senderSlot)} <-> ${displayDate(receiverSlot.date)} ${slotTimeLabel(receiverSlot)}`,
    );

    res.json({ message: 'Арилжаа амжилттай хийгдэж хуваарь автоматаар солигдлоо' });
  } catch (err) {
    await trx.rollback();
    console.error('Respond trade error:', err);
    captureError('trades: Respond trade error:', err);
    res.status(500).json({ error: 'Trade хүсэлтэд хариу өгөхөд алдаа гарлаа' });
  }
});

async function findOrCreateAdjustedSlot(trx: any, baseSlot: any, targetDate: string, keepDuration: number, anchor: 'start' | 'end') {
  if (baseSlot.is_rest || keepDuration === 0) {
    const existingRest = await trx('work_slots').where({ date: targetDate, is_rest: 1, segment: baseSlot.segment, employment_type: baseSlot.employment_type }).first();
    if (existingRest) return existingRest;
    const id = uuidv4();
    const payload = { id, date: targetDate, start_time: '00:00:00', end_time: '00:00:00', duration: 0, capacity: Math.max(1, Number(baseSlot.capacity || 1)), booking_deadline: baseSlot.booking_deadline, segment: baseSlot.segment, employment_type: baseSlot.employment_type, is_rest: 1 };
    await trx('work_slots').insert(payload);
    return payload;
  }

  let startMinutes: number;
  let endMinutes: number;
  const durationMinutes = Math.round(Number(keepDuration) * 60);
  if (anchor === 'end') {
    endMinutes = timeToMinutes(baseSlot.end_time);
    startMinutes = endMinutes - durationMinutes;
  } else {
    startMinutes = timeToMinutes(baseSlot.start_time);
    endMinutes = startMinutes + durationMinutes;
  }
  const start = minutesToSqlTime(startMinutes);
  const end = minutesToSqlTime(endMinutes);
  const existing = await trx('work_slots').where({ date: targetDate, start_time: start, end_time: end, segment: baseSlot.segment, employment_type: baseSlot.employment_type, is_rest: 0 }).first();
  if (existing) return existing;
  const id = uuidv4();
  const payload = { id, date: targetDate, start_time: start, end_time: end, duration: keepDuration, capacity: Math.max(1, Number(baseSlot.capacity || 1)), booking_deadline: baseSlot.booking_deadline, segment: baseSlot.segment, employment_type: baseSlot.employment_type, is_rest: 0 };
  await trx('work_slots').insert(payload);
  return payload;
}

export default router;
