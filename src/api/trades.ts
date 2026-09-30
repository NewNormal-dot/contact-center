import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { logAction } from './audit';
import { isDuplicateKeyError } from '../utils/dbErrors';
import { displayDate, displayTime } from '../utils/sqlDate';
import { captureError } from '../utils/errorLog';
import { invalidateSlotsCache } from './slots';
import { createThrottledTask } from '../utils/throttledTask';
import { columnExists } from '../database/schemaUtils';

const router = express.Router();

// A trade swaps two CSRs' bookings, so a successful write here changes what
// GET /api/slots returns just as much as a booking does.
router.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) invalidateSlotsCache();
  });
  next();
});

// ===== 2026-09-29 feature-detection for the new trade columns =====
// Production applies migrations by hand, so this code can run for a while
// against a database that has not yet received
// 20260929000000_add_trade_v2_fields.ts. columnExists() already caches its
// own result (see clearSchemaExistsCache in schemaUtils), so these are
// thin, cheap wrappers - no extra caching needed here.
async function hasTradeV2Columns() {
  return columnExists(db, 'trade_requests', 'expires_at');
}
async function hasAcquiredViaTradeColumn() {
  return columnExists(db, 'slot_bookings', 'acquired_via_trade');
}

function normalizeEmploymentType(value: unknown) {
  return String(value || 'Full Time').trim() === 'Part Time' ? 'Part Time' : 'Full Time';
}

function normalizeSegment(value: unknown) {
  // No "All" wildcard - segments are fully separate business units. A
  // segment's NAME carries no special meaning - "VIP" is not a privilege
  // tier, it is just a segment like any other, and may only trade with
  // itself (see src/api/slots.ts, which dropped the same VIP/Premium
  // special case for the same reason).
  return String(value || '').trim();
}

function normalizeLocation(value: unknown) {
  return String(value || 'Ulaanbaatar').trim() === 'Darkhan' ? 'Darkhan' : 'Ulaanbaatar';
}

function timeToMinutes(value: string | Date) {
  if (value instanceof Date) return value.getUTCHours() * 60 + value.getUTCMinutes();
  const match = String(value || '').trim().match(/(?:^|[T ])(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToSqlTime(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function isRestSlot(slot: any) {
  return Boolean(slot?.is_rest);
}

// 2026-09-29: two behavioural changes on top of the original rule -
//   1. a bare rest/rest pair is no longer a valid trade at all. Swapping
//      two days off achieves nothing on its own - only a genuine
//      rest<->work two-day swap does (handled separately, see the day2
//      logic in POST / and the accept handler).
//   2. blocked when either the start time OR the end time match, not just
//      the start time. Two work shifts that share an end time (e.g.
//      13:00-20:00 and 15:00-20:00) previously slipped through this check
//      and then hit the duration-preserving swap with nothing to actually
//      change for one side - see computeWorkSwap below for why that
//      combination is a no-op.
function canTradeSlotPair(senderSlot: any, receiverSlot: any) {
  const senderRest = isRestSlot(senderSlot);
  const receiverRest = isRestSlot(receiverSlot);
  if (senderRest && receiverRest) return false;
  if (senderRest !== receiverRest) return true;
  return timeToMinutes(senderSlot.start_time) !== timeToMinutes(receiverSlot.start_time)
    && timeToMinutes(senderSlot.end_time) !== timeToMinutes(receiverSlot.end_time);
}

function positionAnchor(slot: any): 'start' | 'end' {
  return timeToMinutes(slot.start_time) < 12 * 60 ? 'start' : 'end';
}

function slotTimeLabel(slot: any) {
  if (slot?.is_rest) return 'Амралт';
  return `${displayTime(slot.start_time)}-${displayTime(slot.end_time)}`;
}

// ===== 2026-09-29: booking-closed + minimum-notice gate =====
//
// Trading is not the tool for "I don't want this shift" - cancel/rebook is,
// and a shift remains available for exactly as long as booking itself is
// open. Trade only becomes possible once booking has closed for it AND at
// least MIN_HOURS_BEFORE_TRADE_ACTION hours remain before it starts,
// checked both when a request is sent and again when it is accepted (time
// passes between the two, and either gate could stop holding by then).
//
// This only applies to actual WORK shifts. A rest slot has no meaningful
// "start time" for this purpose and is gated only by being a future date
// (see isFutureDateKey below), both in POST / and in the accept handler.
const MIN_HOURS_BEFORE_TRADE_ACTION = 3;

function isSlotBookingCurrentlyOpen(slot: any) {
  if (!slot.booking_is_open) return false;
  const now = Date.now();
  if (slot.booking_open_at && new Date(slot.booking_open_at).getTime() > now) return false;
  if (slot.booking_deadline && new Date(slot.booking_deadline).getTime() < now) return false;
  return true;
}

function shiftStartInstant(slot: any): number {
  const dateKey = displayDate(slot.date);
  const startTime = displayTime(slot.start_time);
  return new Date(`${dateKey}T${startTime}:00+08:00`).getTime();
}

function hoursUntilShiftStart(slot: any) {
  return (shiftStartInstant(slot) - Date.now()) / (1000 * 60 * 60);
}

/** Null when `slot` (a WORK shift) may be traded right now; otherwise why not. */
function whyWorkSlotNotTradeable(slot: any): string | null {
  if (isSlotBookingCurrentlyOpen(slot)) {
    return 'Захиалга нээлттэй байна. Захиалга хаагдсаны дараа л trade хийх боломжтой.';
  }
  const hoursLeft = hoursUntilShiftStart(slot);
  if (hoursLeft < MIN_HOURS_BEFORE_TRADE_ACTION) {
    return hoursLeft < 0
      ? 'Энэ ээлж эхэлсэн эсвэл өнгөрсөн байна.'
      : `Ээлж эхлэхэд ${MIN_HOURS_BEFORE_TRADE_ACTION} цагаас бага хугацаа үлдсэн байна.`;
  }
  return null;
}

// ===== Mongolia local calendar helpers =====
// Mongolia is UTC+8 and does not observe DST; Azure App Service runs in
// UTC. Deriving "today"/week boundaries from the server's own calendar
// would put both a day and, near week boundaries, a whole week out of sync
// with the user between 00:00 and 08:00 local time.
function addDaysToKey(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** Monday of the calendar week containing dateKey. */
function weekStartOf(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + diffToMonday);
  return date.toISOString().slice(0, 10);
}
function weekDateKeys(dateKey: string) {
  const start = weekStartOf(dateKey);
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(start, i));
}
function isFutureDateKey(dateKey: string) {
  return dateKey > todayDateKey();
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
    senderNextSlotId: row.sender_next_slot_id,
    receiverNextSlotId: row.receiver_next_slot_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Present only once the 2026-09-29 migration has run; SELECT * simply
    // omits the column otherwise, so this is always safe to read.
    expiresAt: row.expires_at || null,
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
    isTwoDayTrade: Boolean(row.sender_next_slot_id && row.receiver_next_slot_id),
    senderNextDate: row.sender_next_date ? displayDate(row.sender_next_date) : null,
    receiverNextDate: row.receiver_next_date ? displayDate(row.receiver_next_date) : null,
    senderNextShiftTime: row.sender_next_date
      ? (row.sender_next_is_rest ? 'Амралт' : `${displayTime(row.sender_next_start)}-${displayTime(row.sender_next_end)}`)
      : null,
    receiverNextShiftTime: row.receiver_next_date
      ? (row.receiver_next_is_rest ? 'Амралт' : `${displayTime(row.receiver_next_start)}-${displayTime(row.receiver_next_end)}`)
      : null,
    // Text snapshots (present only once the migration has run) so a trade
    // stays readable in history even after the work_slots rows it pointed
    // at have been merged/reused by later scheduling changes.
    senderNewShiftSummary: row.sender_new_shift_summary || null,
    receiverNewShiftSummary: row.receiver_new_shift_summary || null,
  };
}

function baseTradeQuery(trx: any = db) {
  // LEFT joins throughout. users.sender_id/receiver_id are set to NULL when
  // an account is deleted, so inner joins made the whole trade vanish from
  // every list AND from the /respond lookup - the request simply
  // disappeared rather than being declined or shown as stale.
  return trx('trade_requests')
    .leftJoin('users as sender', 'trade_requests.sender_id', '=', 'sender.id')
    .leftJoin('users as receiver', 'trade_requests.receiver_id', '=', 'receiver.id')
    .leftJoin('work_slots as sender_slot', 'trade_requests.sender_slot_id', '=', 'sender_slot.id')
    .leftJoin('work_slots as receiver_slot', 'trade_requests.receiver_slot_id', '=', 'receiver_slot.id')
    .leftJoin('work_slots as sender_next_slot', 'trade_requests.sender_next_slot_id', '=', 'sender_next_slot.id')
    .leftJoin('work_slots as receiver_next_slot', 'trade_requests.receiver_next_slot_id', '=', 'receiver_next_slot.id')
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
      'sender_next_slot.date as sender_next_date',
      'sender_next_slot.start_time as sender_next_start',
      'sender_next_slot.end_time as sender_next_end',
      'sender_next_slot.is_rest as sender_next_is_rest',
      'receiver_next_slot.date as receiver_next_date',
      'receiver_next_slot.start_time as receiver_next_start',
      'receiver_next_slot.end_time as receiver_next_end',
      'receiver_next_slot.is_rest as receiver_next_is_rest',
    );
}

const ULAANBAATAR_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
function todayDateKey() {
  return new Date(Date.now() + ULAANBAATAR_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

// ===== 2026-09-29 rule helpers shared by POST / and PATCH /:id/respond =====

/**
 * Pending OR approved leave against either booking blocks the trade
 * outright. This replaces the previous approvedLeaveBlocking +
 * withdrawPendingLeaveForTrade pair: a leave request the CSR filed on
 * purpose is never silently withdrawn by someone else's trade - if it is
 * pending, the trade is simply refused until the CSR resolves the leave
 * request themselves.
 */
async function leaveBlockingTrade(conn: any, bookingIds: (string | undefined)[]): Promise<string | null> {
  const ids = bookingIds.filter(Boolean) as string[];
  if (ids.length === 0) return null;
  const row = await conn('leave_requests').whereIn('slot_booking_id', ids).whereIn('status', ['pending', 'approved']).first();
  return row ? 'Энэ ээлжид чөлөөний хүсэлт (хүлээгдэж буй эсвэл зөвшөөрөгдсөн) байгаа тул солих боломжгүй.' : null;
}

/** A booking obtained through an earlier trade may never be traded again. */
async function bookingAcquiredViaTrade(conn: any, bookingId: string | undefined): Promise<boolean> {
  if (!bookingId || !(await hasAcquiredViaTradeColumn())) return false;
  const row = await conn('slot_bookings').where({ id: bookingId }).first();
  return Boolean(row?.acquired_via_trade);
}

/** One approved trade per person per calendar date, full stop. */
async function hasApprovedTradeOnDate(conn: any, userId: string, dateKey: string): Promise<boolean> {
  const row = await conn('trade_requests')
    .leftJoin('work_slots as ss', 'trade_requests.sender_slot_id', 'ss.id')
    .leftJoin('work_slots as rs', 'trade_requests.receiver_slot_id', 'rs.id')
    .leftJoin('work_slots as sn', 'trade_requests.sender_next_slot_id', 'sn.id')
    .leftJoin('work_slots as rn', 'trade_requests.receiver_next_slot_id', 'rn.id')
    .where('trade_requests.status', 'approved')
    .where(function (this: any) {
      this.where('trade_requests.sender_id', userId).orWhere('trade_requests.receiver_id', userId);
    })
    .where(function (this: any) {
      this.where('ss.date', dateKey).orWhere('rs.date', dateKey).orWhere('sn.date', dateKey).orWhere('rn.date', dateKey);
    })
    .first();
  return Boolean(row);
}

/** Every date this trade (proposed or being accepted) would touch. */
function datesInvolved(params: { senderSlot: any; receiverSlot: any; senderNextSlot?: any; receiverNextSlot?: any }) {
  const keys = new Set<string>();
  keys.add(displayDate(params.senderSlot.date));
  keys.add(displayDate(params.receiverSlot.date));
  if (params.senderNextSlot) keys.add(displayDate(params.senderNextSlot.date));
  if (params.receiverNextSlot) keys.add(displayDate(params.receiverNextSlot.date));
  return Array.from(keys);
}

/**
 * The duration-preserving swap for two ordinary WORK (non-rest) shifts on
 * the SAME day (day1 of a same-day trade, or either half of a two-day
 * rest<->work trade's work<->work... no - this is only ever called for a
 * same-day work<->work pair; the rest<->work case is handled entirely by
 * findOrCreateAdjustedSlot + positionAnchor below, unchanged).
 *
 * Whichever shift starts EARLIER ("the morning holder") moves toward the
 * evening: keeps their OWN duration, but the new shift ENDS exactly where
 * the OTHER shift originally ended. Whichever starts LATER ("the evening
 * holder") moves toward the morning: keeps their OWN duration, but the new
 * shift STARTS exactly where the OTHER shift originally started.
 *
 * Anchoring to the OTHER shift's ORIGINAL edge - not to whatever the first
 * half of the swap just produced - is what makes this correct. Chaining
 * the second move off the first move's result silently changes one side's
 * total hours: 09:00-15:00 (6h) <-> 13:00-20:00 (7h), chained from a first
 * move to 09:00-16:00, would give the second person 16:00-22:00 (6h)
 * instead of the correct 14:00-20:00 (6h) - anchored to the 20:00 the 7h
 * shift already ended at, not to a time nobody currently works until.
 *
 * Returns null when canTradeSlotPair should already have refused the pair
 * (same start or same end time) - defensive, should not normally trigger.
 */
function computeWorkSwap(
  shiftA: { start_time: any; end_time: any },
  shiftB: { start_time: any; end_time: any },
  durationAHours: number,
  durationBHours: number,
): { A: { start: string; end: string }; B: { start: string; end: string } } | null {
  const startA = timeToMinutes(shiftA.start_time);
  const startB = timeToMinutes(shiftB.start_time);
  const endA = timeToMinutes(shiftA.end_time);
  const endB = timeToMinutes(shiftB.end_time);
  if (startA === startB || endA === endB) return null;
  const aIsEarlier = startA < startB;
  const originalMorningStart = aIsEarlier ? startA : startB;
  const originalEveningEnd = aIsEarlier ? endB : endA;
  const morningHolderDuration = (aIsEarlier ? durationAHours : durationBHours) * 60;
  const eveningHolderDuration = (aIsEarlier ? durationBHours : durationAHours) * 60;
  const newEveningEnd = originalEveningEnd;
  const newEveningStart = newEveningEnd - morningHolderDuration;
  const newMorningStart = originalMorningStart;
  const newMorningEnd = newMorningStart + eveningHolderDuration;
  const forTheEarlierShiftsHolder = { start: minutesToSqlTime(newEveningStart), end: minutesToSqlTime(newEveningEnd) };
  const forTheLaterShiftsHolder = { start: minutesToSqlTime(newMorningStart), end: minutesToSqlTime(newMorningEnd) };
  return aIsEarlier
    ? { A: forTheEarlierShiftsHolder, B: forTheLaterShiftsHolder }
    : { A: forTheLaterShiftsHolder, B: forTheEarlierShiftsHolder };
}

async function autoDeclineExpiredTradesUnthrottled() {
  const hasV2 = await hasTradeV2Columns();
  const today = todayDateKey();
  // Prefer the precise per-shift expiry (3h before whichever involved
  // shift starts soonest) once the migration has run; fall back to the
  // coarser "past the shift's own calendar date" rule otherwise, so this
  // never throws against a not-yet-migrated database.
  const expired = hasV2
    ? await baseTradeQuery()
        .where('trade_requests.status', 'pending')
        .whereNotNull('trade_requests.expires_at')
        .where('trade_requests.expires_at', '<', new Date().toISOString())
    : await baseTradeQuery()
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

const AUTO_DECLINE_MIN_INTERVAL_MS = 5 * 60 * 1000;

const autoDeclineExpiredTrades = createThrottledTask(
  autoDeclineExpiredTradesUnthrottled,
  AUTO_DECLINE_MIN_INTERVAL_MS,
  'autoDeclineExpiredTrades',
);

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

// ---------------------------------------------------------------------------
// GET /api/trades/candidate-second-days (new 2026-09-29)
//
// For a rest<->work trade, the complementary day (the day the roles
// reverse) is found here, not guessed at by the client:
//   - searched only within the calendar week (Mon-Sun) containing the
//     first day, and only among days that have not happened yet;
//   - the pattern on the candidate day must be the EXACT reverse of the
//     first day (whoever rests on day 1 must have a real, tradeable WORK
//     booking on the candidate day, and vice versa);
//   - every other trade rule (booking closed + 3h on the work side, no
//     pending/approved leave, not already traded-away, no other approved
//     trade that date for either person) is re-checked for the candidate
//     day too, so every day this returns is immediately usable.
// ---------------------------------------------------------------------------
router.get('/candidate-second-days', authenticate, authorize(['csr']), async (req: any, res) => {
  const senderSlotId = String(req.query.senderSlotId || '');
  const receiverSlotId = String(req.query.receiverSlotId || '');
  const receiverId = String(req.query.receiverId || '');
  const senderId = req.user.id;
  if (!senderSlotId || !receiverSlotId || !receiverId) {
    return res.status(400).json({ error: 'senderSlotId, receiverSlotId, receiverId шаардлагатай' });
  }
  try {
    const senderSlot = await db('work_slots').where({ id: senderSlotId }).first();
    const receiverSlot = await db('work_slots').where({ id: receiverSlotId }).first();
    if (!senderSlot || !receiverSlot) return res.status(404).json({ error: 'Ээлж олдсонгүй' });
    const senderRest = isRestSlot(senderSlot);
    const receiverRest = isRestSlot(receiverSlot);
    if (senderRest === receiverRest) {
      // Not a rest<->work pair - either both work (a same-day trade, no
      // second day needed) or both rest (never a valid trade at all).
      return res.json({ candidates: [], applicable: false });
    }
    const day1 = displayDate(senderSlot.date);
    if (displayDate(receiverSlot.date) !== day1) {
      return res.status(400).json({ error: 'Эхний өдрийн хоёр ээлж өөр өдөр байна' });
    }
    const day1WorkSlot = senderRest ? receiverSlot : senderSlot;
    const day1Reason = whyWorkSlotNotTradeable(day1WorkSlot);
    if (day1Reason) {
      return res.json({ candidates: [], applicable: true, blockedReason: day1Reason });
    }
    const segment = normalizeSegment(senderSlot.segment);
    const employmentType = normalizeEmploymentType(senderSlot.employment_type);
    const location = normalizeLocation(senderSlot.location);
    const candidateDates = weekDateKeys(day1).filter((dateKey) => dateKey !== day1 && isFutureDateKey(dateKey));
    const candidates: Array<{ date: string; senderNextSlotId: string; receiverNextSlotId: string }> = [];
    for (const dateKey of candidateDates) {
      // On the candidate day, whoever RESTED on day 1 must have a real,
      // tradeable WORK booking; whoever WORKED on day 1 must be resting.
      const restSideUserId = senderRest ? senderId : receiverId;
      const workSideUserId = senderRest ? receiverId : senderId;
      const restSideNextBooking = await db('slot_bookings')
        .join('work_slots', 'slot_bookings.slot_id', 'work_slots.id')
        .where({ 'slot_bookings.user_id': restSideUserId, 'slot_bookings.status': 'confirmed', 'work_slots.date': dateKey, 'work_slots.is_rest': 0, 'work_slots.segment': segment, 'work_slots.employment_type': employmentType, 'work_slots.location': location })
        .select('slot_bookings.id as booking_id', 'work_slots.*')
        .first();
      const workSideNextBooking = await db('slot_bookings')
        .join('work_slots', 'slot_bookings.slot_id', 'work_slots.id')
        .where({ 'slot_bookings.user_id': workSideUserId, 'slot_bookings.status': 'confirmed', 'work_slots.date': dateKey, 'work_slots.is_rest': 1, 'work_slots.segment': segment, 'work_slots.employment_type': employmentType, 'work_slots.location': location })
        .select('slot_bookings.id as booking_id', 'work_slots.*')
        .first();
      if (!restSideNextBooking || !workSideNextBooking) continue;
      if (whyWorkSlotNotTradeable(restSideNextBooking)) continue;
      if (await leaveBlockingTrade(db, [restSideNextBooking.booking_id])) continue;
      if (await bookingAcquiredViaTrade(db, restSideNextBooking.booking_id)) continue;
      if (await bookingAcquiredViaTrade(db, workSideNextBooking.booking_id)) continue;
      if (await hasApprovedTradeOnDate(db, senderId, dateKey)) continue;
      if (await hasApprovedTradeOnDate(db, receiverId, dateKey)) continue;
      candidates.push({
        date: dateKey,
        senderNextSlotId: senderRest ? workSideNextBooking.id : restSideNextBooking.id,
        receiverNextSlotId: senderRest ? restSideNextBooking.id : workSideNextBooking.id,
      });
    }
    res.json({ candidates, applicable: true });
  } catch (err) {
    console.error('Candidate second days error:', err);
    captureError('trades: candidate-second-days', err);
    res.status(500).json({ error: 'Хос өдөр хайхад алдаа гарлаа' });
  }
});

router.post('/', authenticate, authorize(['csr']), async (req: any, res) => {
  const { receiver_id, receiverId, sender_slot_id, senderSlotId, receiver_slot_id, receiverSlotId, sender_next_slot_id, senderNextSlotId, receiver_next_slot_id, receiverNextSlotId } = req.body;
  const senderId = req.user.id;
  const receiverIdFinal = receiver_id || receiverId;
  const senderSlotIdFinal = sender_slot_id || senderSlotId;
  const receiverSlotIdFinal = receiver_slot_id || receiverSlotId;
  const senderNextSlotIdFinal = sender_next_slot_id || senderNextSlotId || null;
  const receiverNextSlotIdFinal = receiver_next_slot_id || receiverNextSlotId || null;

  if (!receiverIdFinal || !senderSlotIdFinal || !receiverSlotIdFinal) {
    return res.status(400).json({ error: 'Солих хэрэглэгч болон ээлжийн мэдээлэл шаардлагатай' });
  }
  if (receiverIdFinal === senderId) return res.status(400).json({ error: 'Өөртэйгөө ээлж солих боломжгүй' });

  try {
    // 2026-09-29: one outstanding request at a time - a second cannot be
    // sent (to anyone, about anything) until the first has been answered
    // (accepted/declined) or has auto-expired.
    const existingPending = await db('trade_requests').where({ sender_id: senderId, status: 'pending' }).first();
    if (existingPending) {
      return res.status(409).json({ error: 'Танд аль хэдийн хариу хүлээгдэж буй trade хүсэлт байна. Эхлээд түүнд хариу ирэхийг хүлээнэ үү.' });
    }

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

    const leaveBlock = await leaveBlockingTrade(db, [senderBooking.id, receiverBooking.id]);
    if (leaveBlock) return res.status(409).json({ error: leaveBlock });
    if ((await bookingAcquiredViaTrade(db, senderBooking.id)) || (await bookingAcquiredViaTrade(db, receiverBooking.id))) {
      return res.status(409).json({ error: 'Trade-ээр авсан ээлжийг дахин trade хийх боломжгүй.' });
    }

    const senderSlot = await db('work_slots').where({ id: senderSlotIdFinal }).first();
    const receiverSlot = await db('work_slots').where({ id: receiverSlotIdFinal }).first();
    if (!senderSlot || !receiverSlot) return res.status(404).json({ error: 'Солих ээлж олдсонгүй' });
    if (!canTradeSlotPair(senderSlot, receiverSlot)) {
      return res.status(400).json({ error: 'Ижил эхлэх цагтай ээлжийг trade хийх боломжгүй' });
    }

    const senderDate = displayDate(senderSlot.date);
    const receiverDate = displayDate(receiverSlot.date);
    if (senderDate !== receiverDate) {
      return res.status(400).json({ error: 'Зөвхөн нэг өдрийн ээлжийг хооронд нь солих боломжтой' });
    }
    const day1 = senderDate;
    if (!isFutureDateKey(day1)) {
      return res.status(400).json({ error: 'Өнгөрсөн эсвэл өнөөдрийн өдрийн ээлж солих боломжгүй' });
    }

    const senderRest = isRestSlot(senderSlot);
    const receiverRest = isRestSlot(receiverSlot);
    let senderNextSlot: any = null;
    let receiverNextSlot: any = null;

    if (!senderRest && !receiverRest) {
      // Same-day work<->work - no second day involved.
      if (senderNextSlotIdFinal || receiverNextSlotIdFinal) {
        return res.status(400).json({ error: 'Ажлын ээлж хоорондоо солиход хоёр дахь өдөр шаардахгүй' });
      }
      const senderReason = whyWorkSlotNotTradeable(senderSlot);
      if (senderReason) return res.status(400).json({ error: senderReason });
      const receiverReason = whyWorkSlotNotTradeable(receiverSlot);
      if (receiverReason) return res.status(400).json({ error: receiverReason });
      const swap = computeWorkSwap(senderSlot, receiverSlot, Number(senderSlot.duration || 0), Number(receiverSlot.duration || 0));
      if (!swap) {
        return res.status(400).json({ error: 'Ижил эхлэх эсвэл ижил дуусах цагтай ажлын ээлжийг солих боломжгүй' });
      }
    } else {
      // Rest<->work pair on day 1 - REQUIRES a complementary day 2 (the
      // exact reverse pattern), found earlier via GET /candidate-second-days
      // and re-validated in full here rather than trusted blindly.
      if (!senderNextSlotIdFinal || !receiverNextSlotIdFinal) {
        return res.status(400).json({ error: 'Амралт солихын тулд хоёр дахь (нөхөх) өдрийг сонгоно уу' });
      }
      const day1WorkSlot = senderRest ? receiverSlot : senderSlot;
      const day1Reason = whyWorkSlotNotTradeable(day1WorkSlot);
      if (day1Reason) return res.status(400).json({ error: day1Reason });

      senderNextSlot = await db('work_slots').where({ id: senderNextSlotIdFinal }).first();
      receiverNextSlot = await db('work_slots').where({ id: receiverNextSlotIdFinal }).first();
      if (!senderNextSlot || !receiverNextSlot) return res.status(404).json({ error: 'Хоёр дахь өдрийн ээлж олдсонгүй' });
      const day2 = displayDate(senderNextSlot.date);
      if (displayDate(receiverNextSlot.date) !== day2) {
        return res.status(400).json({ error: 'Хоёр дахь өдрийн хоёр ээлж өөр өдөр байна' });
      }
      if (day2 === day1) return res.status(400).json({ error: 'Хоёр дахь өдөр эхний өдрөөс өөр байх ёстой' });
      if (!isFutureDateKey(day2)) return res.status(400).json({ error: 'Хоёр дахь өдөр ирээдүйн өдөр байх ёстой' });
      if (!weekDateKeys(day1).includes(day2)) {
        return res.status(400).json({ error: 'Хоёр дахь өдөр эхний өдөртэй ижил 7 хоногт байх ёстой' });
      }
      const senderNextRest = isRestSlot(senderNextSlot);
      const receiverNextRest = isRestSlot(receiverNextSlot);
      // Day 2 must show the EXACT reverse pattern of day 1.
      const patternReversed = senderRest ? (!senderNextRest && receiverNextRest) : (senderNextRest && !receiverNextRest);
      if (!patternReversed) {
        return res.status(400).json({ error: 'Хоёр дахь өдрийн хуваарь эхний өдрийн эсрэг байх ёстой (амарсан хүн ажиллаж, ажилласан хүн амрах)' });
      }
      const day2WorkSlot = senderNextRest ? receiverNextSlot : senderNextSlot;
      const day2Reason = whyWorkSlotNotTradeable(day2WorkSlot);
      if (day2Reason) return res.status(400).json({ error: day2Reason });

      const senderNextBooking = await db('slot_bookings').where({ user_id: senderId, slot_id: senderNextSlotIdFinal, status: 'confirmed' }).first();
      const receiverNextBooking = await db('slot_bookings').where({ user_id: receiverIdFinal, slot_id: receiverNextSlotIdFinal, status: 'confirmed' }).first();
      if (!senderNextBooking || !receiverNextBooking) return res.status(400).json({ error: 'Хоёр дахь өдрийн захиалга баталгаагүй байна' });

      const leaveBlockDay2 = await leaveBlockingTrade(db, [senderNextBooking.id, receiverNextBooking.id]);
      if (leaveBlockDay2) return res.status(409).json({ error: leaveBlockDay2 });
      if ((await bookingAcquiredViaTrade(db, senderNextBooking.id)) || (await bookingAcquiredViaTrade(db, receiverNextBooking.id))) {
        return res.status(409).json({ error: 'Trade-ээр авсан ээлжийг дахин trade хийх боломжгүй.' });
      }
    }

    // One approved trade per person per calendar date - check every date
    // this proposed trade would touch, for both people.
    for (const dateKey of datesInvolved({ senderSlot, receiverSlot, senderNextSlot, receiverNextSlot })) {
      if (await hasApprovedTradeOnDate(db, senderId, dateKey)) {
        return res.status(409).json({ error: `${dateKey} өдөр аль хэдийн trade хийсэн байна (нэг өдөрт нэг л trade)` });
      }
      if (await hasApprovedTradeOnDate(db, receiverIdFinal, dateKey)) {
        return res.status(409).json({ error: `${dateKey} өдөр ${receiver.name} аль хэдийн trade хийсэн байна (нэг өдөрт нэг л trade)` });
      }
    }

    // Repeatedly pressing send used to create unlimited identical pending
    // trades; the single-pending-request rule above already prevents this,
    // kept as a defensive duplicate check as well.
    const duplicate = await db('trade_requests')
      .where({
        sender_id: senderId,
        receiver_id: receiverIdFinal,
        sender_slot_id: senderSlotIdFinal,
        receiver_slot_id: receiverSlotIdFinal,
        status: 'pending',
      })
      .first();
    if (duplicate) {
      return res.status(409).json({ error: 'Энэ хүсэлтийг аль хэдийн илгээсэн байна.' });
    }

    const id = uuidv4();
    const involvedWorkSlots = [senderSlot, receiverSlot, senderNextSlot, receiverNextSlot].filter((s) => s && !isRestSlot(s));
    const expiresAt = involvedWorkSlots.length
      ? new Date(Math.min(...involvedWorkSlots.map((s) => shiftStartInstant(s))) - MIN_HOURS_BEFORE_TRADE_ACTION * 60 * 60 * 1000).toISOString()
      : null;

    const insertPayload: Record<string, any> = {
      id,
      sender_id: senderId,
      receiver_id: receiverIdFinal,
      sender_slot_id: senderSlotIdFinal,
      receiver_slot_id: receiverSlotIdFinal,
      sender_next_slot_id: senderNextSlotIdFinal,
      receiver_next_slot_id: receiverNextSlotIdFinal,
      status: 'pending',
    };
    if (await hasTradeV2Columns()) {
      insertPayload.expires_at = expiresAt;
    }
    await db('trade_requests').insert(insertPayload);

    await logAction(
      senderId,
      'TRADE_REQUESTED',
      'trade_requests',
      id,
      `${sender.name} -> ${receiver.name} | ${displayDate(senderSlot.date)} ${slotTimeLabel(senderSlot)} <-> ${slotTimeLabel(receiverSlot)}` +
        (senderNextSlot ? ` | 2-р өдөр: ${tradeShiftDesc(senderNextSlot)} <-> ${tradeShiftDesc(receiverNextSlot)}` : ''),
      req,
    );

    await createNotification({
      title: 'Ээлж солих хүсэлт ирлээ',
      content: `${sender.name} танд ${displayDate(senderSlot.date)} ${slotTimeLabel(senderSlot)} ээлжээ ${displayDate(receiverSlot.date)} ${slotTimeLabel(receiverSlot)} ээлжтэй солих хүсэлт илгээлээ.` +
        (senderNextSlot ? ` Хоёр дахь өдөр: ${tradeShiftDesc(senderNextSlot)} <-> ${tradeShiftDesc(receiverNextSlot)}.` : ''),
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
      await logAction(
        req.user.id,
        'TRADE_DECLINED',
        'trade_requests',
        id,
        `${trade.receiver_name} declined ${trade.sender_name}'s trade`,
        req,
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
  // approval gate (admins are only ever notified, see
  // upsertAdminTradeNotification). Everything the 2026-09-29 rules require
  // (booking closed + 3h buffer, no pending/approved leave, not previously
  // traded away, no other approved trade that date) is RE-CHECKED here
  // live, because time has passed since the request was created and any of
  // it could have stopped being true.
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
    if (!canTradeSlotPair(senderSlot, receiverSlot)) {
      await trx.rollback();
      return res.status(409).json({ error: 'Ижил эхлэх цагтай ээлжийг trade хийх боломжгүй' });
    }

    const senderNextSlot = trade.sender_next_slot_id
      ? await trx('work_slots').where({ id: trade.sender_next_slot_id }).first()
      : null;
    const receiverNextSlot = trade.receiver_next_slot_id
      ? await trx('work_slots').where({ id: trade.receiver_next_slot_id }).first()
      : null;
    if (Boolean(senderNextSlot) !== Boolean(receiverNextSlot)) {
      await trx.rollback();
      return res.status(409).json({ error: 'Хоёр дахь өдрийн trade мэдээлэл дутуу байна' });
    }
    if (senderNextSlot && receiverNextSlot && !canTradeSlotPair(senderNextSlot, receiverNextSlot)) {
      await trx.rollback();
      return res.status(409).json({ error: 'Хоёр дахь өдрийн ээлжүүд trade хийх боломжгүй' });
    }

    // Live re-check of the booking-closed + 3h buffer rule, on whichever
    // side of each day pair is the actual WORK shift.
    const senderRestDay1 = isRestSlot(senderSlot);
    const receiverRestDay1 = isRestSlot(receiverSlot);
    if (!senderRestDay1 && !receiverRestDay1) {
      const senderReason = whyWorkSlotNotTradeable(senderSlot);
      if (senderReason) { await trx.rollback(); return res.status(409).json({ error: senderReason }); }
      const receiverReason = whyWorkSlotNotTradeable(receiverSlot);
      if (receiverReason) { await trx.rollback(); return res.status(409).json({ error: receiverReason }); }
    } else {
      const day1WorkSlot = senderRestDay1 ? receiverSlot : senderSlot;
      const day1Reason = whyWorkSlotNotTradeable(day1WorkSlot);
      if (day1Reason) { await trx.rollback(); return res.status(409).json({ error: day1Reason }); }
      if (senderNextSlot && receiverNextSlot) {
        const day2WorkSlot = isRestSlot(senderNextSlot) ? receiverNextSlot : senderNextSlot;
        const day2Reason = whyWorkSlotNotTradeable(day2WorkSlot);
        if (day2Reason) { await trx.rollback(); return res.status(409).json({ error: day2Reason }); }
      }
    }

    const senderBooking = await trx('slot_bookings').where({ user_id: trade.sender_id, slot_id: trade.sender_slot_id, status: 'confirmed' }).first();
    const receiverBooking = await trx('slot_bookings').where({ user_id: trade.receiver_id, slot_id: trade.receiver_slot_id, status: 'confirmed' }).first();
    if (!senderBooking || !receiverBooking) throw new Error('Bookings are no longer available');
    const senderNextBooking = senderNextSlot
      ? await trx('slot_bookings').where({ user_id: trade.sender_id, slot_id: senderNextSlot.id, status: 'confirmed' }).first()
      : null;
    const receiverNextBooking = receiverNextSlot
      ? await trx('slot_bookings').where({ user_id: trade.receiver_id, slot_id: receiverNextSlot.id, status: 'confirmed' }).first()
      : null;
    if (senderNextSlot && receiverNextSlot && (!senderNextBooking || !receiverNextBooking)) {
      throw new Error('Second-day bookings are no longer available');
    }

    const allBookingIds = [senderBooking.id, receiverBooking.id, senderNextBooking?.id, receiverNextBooking?.id].filter(Boolean) as string[];
    const leaveBlock = await leaveBlockingTrade(trx, allBookingIds);
    if (leaveBlock) {
      await trx.rollback();
      return res.status(409).json({ error: leaveBlock });
    }
    for (const bookingId of allBookingIds) {
      if (await bookingAcquiredViaTrade(trx, bookingId)) {
        await trx.rollback();
        return res.status(409).json({ error: 'Trade-ээр авсан ээлжийг дахин trade хийх боломжгүй.' });
      }
    }
    for (const dateKey of datesInvolved({ senderSlot, receiverSlot, senderNextSlot, receiverNextSlot })) {
      if ((await hasApprovedTradeOnDate(trx, trade.sender_id, dateKey)) || (await hasApprovedTradeOnDate(trx, trade.receiver_id, dateKey))) {
        await trx.rollback();
        return res.status(409).json({ error: `${dateKey} өдөр аль хэдийн өөр trade хийгдсэн байна (нэг өдөрт нэг л trade)` });
      }
    }

    // ----- Compute where each person's booking actually moves to -----
    //
    // Unchanged from before for the rest<->work case (positionAnchor +
    // findOrCreateAdjustedSlot already correctly preserve the WORK shift
    // holder's own duration, anchored to whichever edge of the ORIGINAL
    // shift is on the far side of noon). Only the work<->work branch
    // changes: it used to always anchor='start' on both new slots and
    // chain the second move off the first move's own end_time - see
    // computeWorkSwap's doc comment above for the bug that produced.
    const createTradeTargets = async (currentSender: any, currentReceiver: any, senderDuration: number, receiverDuration: number) => {
      if (isRestSlot(currentSender) && isRestSlot(currentReceiver)) {
        // Defensive only - a bare rest/rest pair is refused before this
        // point (canTradeSlotPair returns false for it).
        throw new Error('REST_REST_NOT_TRADEABLE');
      }

      if (isRestSlot(currentSender) || isRestSlot(currentReceiver)) {
        const workSlot = isRestSlot(currentSender) ? currentReceiver : currentSender;

        if (isRestSlot(currentSender)) {
          if (!senderDuration) throw new Error('Missing sender work duration for rest trade');
          return {
            sender: await findOrCreateAdjustedSlot(trx, { ...workSlot, segment: currentSender.segment, employment_type: currentSender.employment_type }, displayDate(currentSender.date), senderDuration, positionAnchor(workSlot)),
            receiver: currentSender,
          };
        }

        if (!receiverDuration) throw new Error('Missing receiver work duration for rest trade');
        return {
          sender: currentReceiver,
          receiver: await findOrCreateAdjustedSlot(trx, { ...workSlot, segment: currentReceiver.segment, employment_type: currentReceiver.employment_type }, displayDate(currentReceiver.date), receiverDuration, positionAnchor(workSlot)),
        };
      }

      const swap = computeWorkSwap(currentSender, currentReceiver, senderDuration, receiverDuration);
      if (!swap) throw new Error('DEGENERATE_SWAP');
      const sender = await findOrCreateAdjustedSlotFromTimes(trx, currentSender, displayDate(currentSender.date), swap.A.start, swap.A.end);
      const receiver = await findOrCreateAdjustedSlotFromTimes(trx, currentReceiver, displayDate(currentReceiver.date), swap.B.start, swap.B.end);
      return { sender, receiver };
    };

    const pickPreservedDuration = (slot: any, fallbackSlot: any) => {
      const slotDuration = Number(slot?.duration || 0);
      const fallbackDuration = Number(fallbackSlot?.duration || 0);
      if (slot && !isRestSlot(slot) && slotDuration > 0) return slotDuration;
      if (fallbackSlot && !isRestSlot(fallbackSlot) && fallbackDuration > 0) return fallbackDuration;
      return slotDuration || fallbackDuration || 0;
    };

    let firstTargets: { sender: any; receiver: any };
    let secondTargets: { sender: any; receiver: any } | null = null;
    try {
      firstTargets = await createTradeTargets(
        senderSlot,
        receiverSlot,
        pickPreservedDuration(senderNextSlot || senderSlot, senderSlot),
        pickPreservedDuration(receiverNextSlot || receiverSlot, receiverSlot),
      );
      secondTargets = senderNextSlot && receiverNextSlot
        ? await createTradeTargets(
            senderNextSlot,
            receiverNextSlot,
            pickPreservedDuration(senderSlot, senderNextSlot),
            pickPreservedDuration(receiverSlot, receiverNextSlot),
          )
        : null;
    } catch (swapErr: any) {
      await trx.rollback();
      if (swapErr?.message === 'DEGENERATE_SWAP') {
        return res.status(409).json({ error: 'Ижил эхлэх эсвэл ижил дуусах цагтай ажлын ээлжийг солих боломжгүй' });
      }
      throw swapErr;
    }
    const senderNewSlot = firstTargets.sender;
    const receiverNewSlot = firstTargets.receiver;

    const bookingPairs = [
      { senderBooking, receiverBooking, senderTarget: senderNewSlot, receiverTarget: receiverNewSlot },
      ...(senderNextSlot && receiverNextSlot
        ? [{ senderBooking: senderNextBooking!, receiverBooking: receiverNextBooking!, senderTarget: secondTargets!.sender, receiverTarget: secondTargets!.receiver }]
        : []),
    ];

    const capacityError = (await Promise.all(
      bookingPairs.flatMap(pair => [
        assertCapacityAvailable(trx, pair.senderTarget, [pair.senderBooking.id, pair.receiverBooking.id]),
        assertCapacityAvailable(trx, pair.receiverTarget, [pair.senderBooking.id, pair.receiverBooking.id]),
      ]),
    )).find(Boolean);
    if (capacityError) {
      await trx.rollback();
      return res.status(409).json({ error: capacityError });
    }

    // slot_bookings carries UNIQUE(slot_id, user_id) and cancelling is a soft
    // delete, so either CSR may still own a leftover cancelled row for the
    // slot we are about to move them onto. Without clearing it first the
    // swap below fails the constraint and the whole trade 500s. See the same
    // fix in bookHandler (src/api/slots.ts).
    for (const pair of bookingPairs) {
      await clearLeftoverBooking(trx, pair.senderTarget.id, trade.sender_id, pair.senderBooking.id);
      await clearLeftoverBooking(trx, pair.receiverTarget.id, trade.receiver_id, pair.receiverBooking.id);
    }

    const hasAcquiredCol = await hasAcquiredViaTradeColumn();
    for (const pair of bookingPairs) {
      const senderUpdate: Record<string, any> = { slot_id: pair.senderTarget.id, booked_at: trx.fn.now() };
      const receiverUpdate: Record<string, any> = { slot_id: pair.receiverTarget.id, booked_at: trx.fn.now() };
      if (hasAcquiredCol) {
        // A shift obtained by trading must not become tradeable bait for a
        // second trade - both bookings this trade produces are flagged so
        // leaveBlockingTrade's sibling check (bookingAcquiredViaTrade) can
        // refuse any future attempt to trade them again.
        senderUpdate.acquired_via_trade = true;
        receiverUpdate.acquired_via_trade = true;
      }
      await trx('slot_bookings').where({ id: pair.senderBooking.id }).update(senderUpdate);
      await trx('slot_bookings').where({ id: pair.receiverBooking.id }).update(receiverUpdate);
    }

    // Any OTHER pending request that referenced one of these now-vacated
    // slots is no longer answerable - its slot no longer holds the booking
    // it was proposing to trade away.
    const consumedSlotIds = [senderSlot.id, receiverSlot.id, senderNextSlot?.id, receiverNextSlot?.id].filter(Boolean) as string[];
    const siblings = await trx('trade_requests')
      .where({ status: 'pending' })
      .whereNot({ id })
      .where(function (this: any) {
        this.whereIn('sender_slot_id', consumedSlotIds)
          .orWhereIn('receiver_slot_id', consumedSlotIds)
          .orWhereIn('sender_next_slot_id', consumedSlotIds)
          .orWhereIn('receiver_next_slot_id', consumedSlotIds);
      });
    for (const sib of siblings) {
      await trx('trade_requests').where({ id: sib.id }).update({ status: 'rejected', updated_at: trx.fn.now() });
      await createNotification(
        {
          title: 'Trade хүсэлт цуцлагдлаа',
          content: 'Холбогдох ээлж өөр trade-ээр аль хэдийн өөрчлөгдсөн тул таны хүсэлт автоматаар цуцлагдлаа.',
          targetUserId: sib.sender_id,
          relatedEntityType: 'trade_requests',
          relatedEntityId: sib.id,
          type: 'important',
        },
        trx,
      );
    }

    const updatePayload: Record<string, any> = { status: 'approved', receiver_responded_at: trx.fn.now(), admin_decided_at: trx.fn.now(), updated_at: trx.fn.now() };
    if (await hasTradeV2Columns()) {
      updatePayload.sender_new_shift_summary = tradeShiftDesc(senderNewSlot);
      updatePayload.receiver_new_shift_summary = tradeShiftDesc(receiverNewSlot);
    }
    const tradeUpdated = await trx('trade_requests')
      .where({ id, status: 'pending' })
      .update(updatePayload);

    if (tradeUpdated !== 1) {
      await trx.rollback();
      return res.status(409).json({ error: 'Арилжааны төлөв өөрчлөгдсөн байна' });
    }

    await createNotification({ title: 'Ээлж амжилттай солигдлоо', content: `Таны шинэ хуваарь: ${displayDate(senderNewSlot.date)} ${slotTimeLabel(senderNewSlot)}.`, authorId: req.user.id, targetUserId: trade.sender_id, relatedEntityType: 'trade_requests', relatedEntityId: id, type: 'important' }, trx);
    await createNotification({ title: 'Ээлж амжилттай солигдлоо', content: `Таны шинэ хуваарь: ${displayDate(receiverNewSlot.date)} ${slotTimeLabel(receiverNewSlot)}.`, authorId: req.user.id, targetUserId: trade.receiver_id, relatedEntityType: 'trade_requests', relatedEntityId: id, type: 'important' }, trx);
    if (secondTargets) {
      await createNotification({ title: 'Ээлж амжилттай солигдлоо (2-р өдөр)', content: `Таны шинэ хуваарь: ${tradeShiftDesc(secondTargets.sender)}.`, authorId: req.user.id, targetUserId: trade.sender_id, relatedEntityType: 'trade_requests', relatedEntityId: id, type: 'important' }, trx);
      await createNotification({ title: 'Ээлж амжилттай солигдлоо (2-р өдөр)', content: `Таны шинэ хуваарь: ${tradeShiftDesc(secondTargets.receiver)}.`, authorId: req.user.id, targetUserId: trade.receiver_id, relatedEntityType: 'trade_requests', relatedEntityId: id, type: 'important' }, trx);
    }
    await upsertAdminTradeNotification(
      id,
      'Ээлж солих хүсэлт',
      `${trade.sender_name} одоо ${tradeShiftDesc(senderNewSlot)} ажиллана, ${trade.receiver_name} одоо ${tradeShiftDesc(receiverNewSlot)} ажиллана.` +
        (secondTargets ? ` 2-р өдөр: ${trade.sender_name} ${tradeShiftDesc(secondTargets.sender)}, ${trade.receiver_name} ${tradeShiftDesc(secondTargets.receiver)}.` : ''),
      trx,
    );

    await trx.commit();

    await logAction(
      req.user.id,
      'TRADE_COMPLETED',
      'trade_requests',
      id,
      `${trade.sender_name} (${trade.sender_email}) <-> ${trade.receiver_name} (${trade.receiver_email}) | segment: ${trade.sender_segment} | ${displayDate(senderSlot.date)} ${slotTimeLabel(senderSlot)} <-> ${displayDate(receiverSlot.date)} ${slotTimeLabel(receiverSlot)}` +
        (secondTargets ? ` | 2-р өдөр: ${tradeShiftDesc(senderNextSlot)} <-> ${tradeShiftDesc(receiverNextSlot)}` : ''),
      req,
    );

    res.json({ message: 'Арилжаа амжилттай хийгдэж хуваарь автоматаар солигдлоо' });
  } catch (err) {
    await trx.rollback();
    console.error('Respond trade error:', err);
    captureError('trades: Respond trade error:', err);
    res.status(500).json({ error: 'Trade хүсэлтэд хариу өгөхөд алдаа гарлаа' });
  }
});

async function assertCapacityAvailable(trx: any, slot: any, movingBookingIds: string[]) {
  const [{ count }] = await trx('slot_bookings')
    .where({ slot_id: slot.id, status: 'confirmed' })
    .whereNotIn('id', movingBookingIds)
    .count('id as count');
  if (Number(count) + 1 > Number(slot.capacity || 0)) {
    return `"${displayDate(slot.date)} ${slotTimeLabel(slot)}" ээлжийн орон тоо дүүрсэн тул солих боломжгүй.`;
  }
  return null;
}

async function clearLeftoverBooking(trx: any, slotId: string, userId: string | null, keepBookingId: string) {
  if (!userId) return;
  await trx('slot_bookings')
    .where({ slot_id: slotId, user_id: userId })
    .whereNot({ id: keepBookingId })
    .whereNot({ status: 'confirmed' })
    .delete();
}

async function findOrCreateAdjustedSlot(trx: any, baseSlot: any, targetDate: string, keepDuration: number, anchor: 'start' | 'end') {
  const location = normalizeLocation(baseSlot.location);
  if (baseSlot.is_rest || keepDuration === 0) {
    const restCriteria = { date: targetDate, start_time: '00:00:00', end_time: '00:00:00', is_rest: 1, segment: baseSlot.segment, employment_type: baseSlot.employment_type, location };
    const existingRest = await trx('work_slots').where({ date: targetDate, is_rest: 1, segment: baseSlot.segment, employment_type: baseSlot.employment_type, location }).first();
    if (existingRest) return existingRest;
    const id = uuidv4();
    const payload = { id, date: targetDate, start_time: '00:00:00', end_time: '00:00:00', duration: 0, capacity: Math.max(1, Number(baseSlot.capacity || 1)), booking_deadline: baseSlot.booking_deadline, segment: baseSlot.segment, employment_type: baseSlot.employment_type, location, is_rest: 1 };
    return insertOrTakeExisting(trx, payload, restCriteria);
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
  return findOrCreateAdjustedSlotFromTimes(trx, baseSlot, targetDate, start, end);
}

/**
 * New 2026-09-29: the work<->work counterpart of findOrCreateAdjustedSlot,
 * for when the target start/end times have already been computed directly
 * (by computeWorkSwap) rather than derived from a kept duration + anchor
 * edge. Shares the same find-or-create-with-race-handling behaviour via
 * insertOrTakeExisting.
 */
async function findOrCreateAdjustedSlotFromTimes(trx: any, baseSlot: any, targetDate: string, startTime: string, endTime: string) {
  const location = normalizeLocation(baseSlot.location);
  const criteria = { date: targetDate, start_time: startTime, end_time: endTime, segment: baseSlot.segment, employment_type: baseSlot.employment_type, location, is_rest: 0 };
  const existing = await trx('work_slots').where(criteria).first();
  if (existing) return existing;
  const durationHours = (((timeToMinutes(endTime) - timeToMinutes(startTime)) % 1440) + 1440) % 1440 / 60;
  const id = uuidv4();
  const payload = { id, date: targetDate, start_time: startTime, end_time: endTime, duration: durationHours, capacity: Math.max(1, Number(baseSlot.capacity || 1)), booking_deadline: baseSlot.booking_deadline, segment: baseSlot.segment, employment_type: baseSlot.employment_type, location, is_rest: 0 };
  return insertOrTakeExisting(trx, payload, criteria);
}

async function insertOrTakeExisting(trx: any, payload: any, criteria: Record<string, any>) {
  try {
    await trx('work_slots').insert(payload);
    return payload;
  } catch (err: any) {
    if (!isDuplicateKeyError(err)) throw err;
    const raced = await trx('work_slots').where(criteria).first();
    if (!raced) throw err;
    return raced;
  }
}

export default router;
