import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { logAction } from './audit';
import { displayDate, displayTime } from '../utils/sqlDate';

const router = express.Router();

function normalizeEmploymentType(value: unknown) {
  return String(value || 'Full Time').trim() === 'Part Time' ? 'Part Time' : 'Full Time';
}

function normalizeSegment(value: unknown) {
  // No "All" wildcard - segments are fully separate business units.
  return String(value || '').trim();
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

async function notifyAdmins(title: string, content: string, tradeId: string, authorId?: string | null, trx: any = db) {
  const admins = await trx('users').whereIn('role', ['admin', 'superadmin']).select('id');
  await Promise.all(admins.map((admin: any) => createNotification({
    title,
    content,
    authorId: authorId || null,
    targetUserId: admin.id,
    relatedEntityType: 'trade_requests',
    relatedEntityId: tradeId,
    type: 'important',
  }, trx)));
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
      'receiver.name as receiver_name',
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

router.get('/', authenticate, async (req: any, res) => {
  try {
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

    res.status(201).json({ id });
  } catch (err) {
    console.error('Create trade error:', err);
    res.status(500).json({ error: 'Арилжааны хүсэлт үүсгэхэд алдаа гарлаа' });
  }
});

router.patch('/:id/respond', authenticate, authorize(['csr']), async (req: any, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'Хариуны төлөв буруу байна' });

  try {
    const trade = await baseTradeQuery().where('trade_requests.id', id).first();
    if (!trade || trade.receiver_id !== req.user.id) return res.status(404).json({ error: 'Арилжааны хүсэлт олдсонгүй' });
    if (trade.status !== 'pending') return res.status(400).json({ error: 'Зөвхөн хүлээгдэж буй хүсэлтэд хариу өгнө' });

    await db('trade_requests').where({ id }).update({ status, receiver_responded_at: db.fn.now(), updated_at: db.fn.now() });

    if (status === 'accepted') {
      await notifyAdmins('Trade approve шаардлагатай', `${trade.sender_name} ↔ ${trade.receiver_name} trade хүсэлт receiver зөвшөөрсөн.`, id, req.user.id);
      await createNotification({
        title: 'Trade хүсэлт зөвшөөрөгдлөө',
        content: `${trade.receiver_name} таны trade хүсэлтийг зөвшөөрлөө. Одоо admin approve хүлээгдэж байна.`,
        authorId: req.user.id,
        targetUserId: trade.sender_id,
        relatedEntityType: 'trade_requests',
        relatedEntityId: id,
        type: 'important',
      });
    } else {
      await createNotification({
        title: 'Trade хүсэлт татгалзлаа',
        content: `${trade.receiver_name} таны trade хүсэлтээс татгалзлаа.`,
        authorId: req.user.id,
        targetUserId: trade.sender_id,
        relatedEntityType: 'trade_requests',
        relatedEntityId: id,
        type: 'important',
      });
    }

    res.json({ message: 'Амжилттай хариу илгээлээ' });
  } catch (err) {
    console.error('Respond trade error:', err);
    res.status(500).json({ error: 'Trade хүсэлтэд хариу өгөхөд алдаа гарлаа' });
  }
});

router.patch('/:id/reject', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  try {
    const trade = await baseTradeQuery().where('trade_requests.id', req.params.id).first();
    if (!trade) return res.status(404).json({ error: 'Trade хүсэлт олдсонгүй' });
    if (trade.status === 'approved') {
      return res.status(400).json({ error: 'Батлагдсан арилжааг татгалзах боломжгүй' });
    }
    const rejected = await db('trade_requests')
      .where({ id: req.params.id })
      .whereNot({ status: 'approved' })
      .update({ status: 'rejected', approved_by: req.user.id, admin_decided_at: db.fn.now(), updated_at: db.fn.now() });
    if (!rejected) return res.status(409).json({ error: 'Арилжааны төлөв өөрчлөгдсөн байна' });
    await createNotification({ title: 'Trade хүсэлт татгалзлаа', content: 'Admin таны trade хүсэлтээс татгалзлаа.', authorId: req.user.id, targetUserId: trade.sender_id, relatedEntityType: 'trade_requests', relatedEntityId: req.params.id, type: 'important' });
    await createNotification({ title: 'Trade хүсэлт татгалзлаа', content: 'Admin таны оролцсон trade хүсэлтээс татгалзлаа.', authorId: req.user.id, targetUserId: trade.receiver_id, relatedEntityType: 'trade_requests', relatedEntityId: req.params.id, type: 'important' });
    await logAction(req.user.id, 'REJECT_TRADE', 'trade_requests', req.params.id, 'Trade rejected');
    res.json({ message: 'Арилжааны хүсэлт татгалзагдлаа' });
  } catch (err) {
    console.error('Reject trade error:', err);
    res.status(500).json({ error: 'Арилжаа татгалзахад алдаа гарлаа' });
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

router.patch('/:id/approve', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const trx = await db.transaction();
  try {
    const trade = await baseTradeQuery(trx).where('trade_requests.id', req.params.id).first();
    if (!trade || trade.status !== 'accepted') {
      await trx.rollback();
      return res.status(400).json({ error: 'Зөвхөн receiver зөвшөөрсөн хүсэлтийг батална' });
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
      .where({ id: req.params.id, status: 'accepted' })
      .update({ status: 'approved', approved_by: req.user.id, admin_decided_at: trx.fn.now(), updated_at: trx.fn.now() });

    if (tradeUpdated !== 1) {
      await trx.rollback();
      return res.status(409).json({ error: 'Арилжааны төлөв өөрчлөгдсөн байна' });
    }

    await createNotification({ title: 'Trade батлагдлаа', content: `Таны шинэ хуваарь: ${displayDate(senderNewSlot.date)} ${slotTimeLabel(senderNewSlot)}.`, authorId: req.user.id, targetUserId: trade.sender_id, relatedEntityType: 'trade_requests', relatedEntityId: req.params.id, type: 'important' }, trx);
    await createNotification({ title: 'Trade батлагдлаа', content: `Таны шинэ хуваарь: ${displayDate(receiverNewSlot.date)} ${slotTimeLabel(receiverNewSlot)}.`, authorId: req.user.id, targetUserId: trade.receiver_id, relatedEntityType: 'trade_requests', relatedEntityId: req.params.id, type: 'important' }, trx);

    await trx.commit();
    await logAction(req.user.id, 'APPROVE_TRADE', 'trade_requests', req.params.id, `Trade approved between ${trade.sender_id} and ${trade.receiver_id}`);
    res.json({ message: 'Арилжаа батлагдаж хуваарь автоматаар солигдлоо' });
  } catch (err) {
    await trx.rollback();
    console.error('Approve trade error:', err);
    res.status(500).json({ error: 'Trade approve хийхэд алдаа гарлаа' });
  }
});

export default router;
