import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db, { withDbRetry } from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { toSqlDate, toSqlDateTime, toSqlTime, displayDate, displayTime } from '../utils/sqlDate';
import { captureError } from '../utils/errorLog';
import { isDuplicateKeyError } from '../utils/dbErrors';
import { logAction } from './audit';
import { columnExists } from '../database/schemaUtils';

const router = express.Router();

// Any successful write through this router changes the schedule or its
// bookings, so the shared GET /api/slots cache must be dropped immediately.
// Doing it here - once, for every non-GET route - means a future endpoint
// can never be added and silently forget to invalidate, which would serve
// stale data for up to the cache TTL.
router.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) invalidateSlotsCache();
  });
  next();
});

// work_slots.id is a real DB `uuid` column (uniqueidentifier on Azure SQL).
// The frontend generates a temporary client-side id (e.g. "ez737ec2z", via
// Math.random().toString(36)) for shifts that only exist in the UI and
// haven't been saved yet. If that temporary id is sent through unchanged, a
// non-UUID string gets inserted into a uuid column - Azure SQL rejects this
// with a type-conversion error, causing the whole sync-schedules request to
// fail (sqlite doesn't enforce the column type, so this never showed up in
// local/dev testing). This regex lets us trust a client-supplied id only
// when it's actually a valid UUID; otherwise we mint a fresh one.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function toValidUuidOrNew(candidate: unknown): string {
  const value = String(candidate || '').trim();
  return UUID_REGEX.test(value) ? value : uuidv4();
}

function displayDateTime(value: unknown) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeEmploymentType(value: unknown) {
  return String(value || 'Full Time').trim() === 'Part Time' ? 'Part Time' : 'Full Time';
}

// Location is a hard two-value dimension like employment type (unlike
// segment, which is open-ended) - so it gets the same "always resolve to a
// known value" treatment. 'Ulaanbaatar' is the default for the same reason
// the DB column defaults to it: every row that existed before this
// dimension was introduced is implicitly Ulaanbaatar data.
function normalizeLocation(value: unknown) {
  return String(value || 'Ulaanbaatar').trim() === 'Darkhan' ? 'Darkhan' : 'Ulaanbaatar';
}

// IMPORTANT: this is a DISPLAY-ONLY fallback for reading/showing existing
// records that might have missing segment data (e.g. legacy rows). It must
// NEVER be used when validating or writing new shifts - segments are fully
// separate business units (Prepaid, Postpaid, VIP, etc.) each with their
// own Full Time / Part Time CSRs, and a shift belongs to exactly one of
// them. There is intentionally no "applies to everyone" wildcard segment.
function normalizeSegmentForDisplay(value: unknown) {
  return String(value || 'All').trim() || 'All';
}

function segmentsMatch(slotSegment: unknown, userSegment: unknown) {
  const slotValue = String(slotSegment || '').trim();
  const userValue = String(userSegment || '').trim();
  return slotValue === userValue || (userValue === 'VIP' && slotValue === 'Premium');
}

function normalizeTime(value: unknown) {
  const sql = toSqlTime(value as any);
  return sql || '';
}

function parseShiftTimeRange(value: string) {
  const trimmed = String(value || '').trim();
  const match = trimmed.match(/^([0-1]?\d|2[0-3])(?::(\d{2}))?\s*[-–—]\s*([0-1]?\d|2[0-3])(?::(\d{2}))?$/);
  if (!match) return null;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2] || '0');
  const endHour = Number(match[3]);
  const endMinute = Number(match[4] || '0');

  if (
    startHour < 0 || startHour > 23 ||
    endHour < 0 || endHour > 23 ||
    startMinute < 0 || startMinute > 59 ||
    endMinute < 0 || endMinute > 59
  ) {
    return null;
  }

  return {
    startTime: `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`,
    endTime: `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`,
  };
}

function calculateDuration(startTime: string, endTime: string, explicitDuration?: unknown) {
  if (Number.isFinite(Number(explicitDuration)) && Number(explicitDuration) > 0) return Number(explicitDuration);
  const start = new Date(`1970-01-01T${startTime}`);
  const end = new Date(`1970-01-01T${endTime}`);
  let duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  if (duration <= 0) duration += 24;
  return duration;
}

// Single source of truth for a slot's duration in hours, used both for
// display (mapSlot/mapBooking, what admins/CSRs see) and for weekly-rule
// enforcement (hourKeyForSlot). Always prefers recomputing from the actual
// start_time/end_time span over trusting the stored `duration` column, so
// a stale/mismatched duration value can never again cause the wrong shift
// length to be displayed or enforced. When a real mismatch is found, it's
// logged server-side (visible in Azure log stream / recent-errors) so the
// stale DB row can be identified and re-saved to fix it at the source.
function resolveSlotDurationHours(slot: any) {
  if (slot.is_rest || slot.isRest) return 0;
  const start = slot.start_time || slot.startTime;
  const end = slot.end_time || slot.endTime;
  const stored = Number(slot.duration || 0);
  if (!start || !end) return stored;

  const computed = calculateDuration(String(start), String(end));
  if (!Number.isFinite(computed) || computed <= 0) return stored;

  if (stored > 0 && Math.round(computed) !== Math.round(stored)) {
    console.warn('Slot duration mismatch detected (using computed value):', {
      slotId: slot.id,
      date: slot.date,
      start_time: start,
      end_time: end,
      stored_duration: stored,
      computed_duration: computed,
    });
  }
  return computed;
}

// Booking waves are persisted as JSON on work_slots.booking_waves, and each
// booking records which wave it used. Both columns arrive with a migration
// that production applies by hand, so everything below degrades to "one
// undivided pool" - today's behaviour - when they are absent.
async function hasBookingWaveColumns() {
  return (await columnExists(db, 'work_slots', 'booking_waves'))
    && (await columnExists(db, 'slot_bookings', 'booking_wave_id'));
}

interface StoredWave {
  id: string;
  name: string;
  slotLimit: number;
  bookingOpen: boolean;
  bookingOpenAt: string | null;
  bookingCloseAt: string | null;
}

function normalizeWavesForStorage(waves: any): StoredWave[] {
  if (!Array.isArray(waves)) return [];
  return waves
    .map((wave: any, index: number) => ({
      id: String(wave?.id || `wave-${index + 1}`).slice(0, 64),
      name: String(wave?.name || `Эрх ${index + 1}`).slice(0, 100),
      slotLimit: Math.max(0, Math.min(9999, Number(wave?.slotLimit ?? wave?.slots ?? wave?.capacity ?? 0) || 0)),
      bookingOpen: boolValue(wave?.bookingOpen),
      bookingOpenAt: wave?.bookingOpenAt ? String(wave.bookingOpenAt) : null,
      bookingCloseAt: wave?.bookingCloseAt ? String(wave.bookingCloseAt) : null,
    }))
    // A wave with no quota is not a wave; keeping them would let an empty
    // "Оройн slot" block every booking.
    .filter((wave: StoredWave) => wave.slotLimit > 0);
}

function parseStoredWaves(value: unknown): StoredWave[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function boolValue(value: unknown) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function resolveBookingWindow(day: any, shift: any) {
  const waves = Array.isArray(shift?.bookingWaves) ? shift.bookingWaves : [];

  // Only an open wave may contribute its timestamp to the shift-level
  // booking window. Closed waves can contain stale bookingOpenAt values from
  // an earlier schedule; treating those values as active makes a shift that
  // was just opened immediately appear scheduled again after the next poll.
  const configuredWaves = waves.filter((wave: any) => boolValue(wave.bookingOpen));

  // When waves are present, their state is authoritative. In particular, an
  // open wave with no bookingOpenAt means "open now" and must not inherit a
  // stale shift-level timestamp from an older scheduled window.
  const openAt = configuredWaves.find((wave: any) => wave.bookingOpenAt)?.bookingOpenAt
    || (waves.length === 0 ? shift.bookingOpenAt : null);
  const closeAt = configuredWaves.find((wave: any) => wave.bookingCloseAt)?.bookingCloseAt
    || shift.bookingCloseAt
    || shift.bookingDeadline
    || null;

  // IMPORTANT: this must be resolved PER SHIFT (segment + employment type),
  // never from the day-level `day.bookingOpen` flag. A single sync-schedules
  // request carries every shift for a date across ALL segments and
  // employment types together, so falling back to a day-wide flag here used
  // to force-open (or force-close) every other segment/employment type's
  // shift on that same date as a side effect of opening just one of them.
  // Each shift's own `bookingOpen` field / `bookingWaves` is what the admin
  // UI actually scopes to the segment + employment type being edited, so
  // that - and only that - is what should decide this shift's window.
  const explicitlyOpen = waves.length === 0 && shift?.bookingOpen !== undefined
    ? boolValue(shift.bookingOpen)
    : false;
  const bookingOpen = explicitlyOpen || configuredWaves.length > 0 || Boolean(openAt);

  return {
    bookingOpen,
    bookingOpenAt: bookingOpen ? toSqlDateTime(openAt) : null,
    bookingDeadline: bookingOpen
      ? toSqlDateTime(closeAt, new Date(Date.now() + 24 * 60 * 60 * 1000))
      : null,
  };
}

function slotIdentity(slot: any) {
  return [
    displayDate(slot.date),
    displayTime(slot.start_time),
    displayTime(slot.end_time),
    normalizeSegmentForDisplay(slot.segment),
    normalizeEmploymentType(slot.employment_type),
    normalizeLocation(slot.location),
    boolValue(slot.is_rest) ? '1' : '0',
  ].join('|');
}

function mapSlot(slot: any, currentBookings = 0, bookings: any[] = []) {
  const isRest = Boolean(slot.is_rest || slot.isRest);
  return {
    ...slot,
    id: slot.id,
    date: displayDate(slot.date),
    startTime: isRest ? 'Амралт' : displayTime(slot.start_time),
    endTime: isRest ? 'Амралт' : displayTime(slot.end_time),
    duration: Number(resolveSlotDurationHours(slot).toFixed(2)),
    capacity: Number(slot.capacity || 0),
    bookingOpen: boolValue(slot.booking_is_open),
    bookingOpenAt: displayDateTime(slot.booking_open_at),
    bookingDeadline: displayDateTime(slot.booking_deadline),
    segment: normalizeSegmentForDisplay(slot.segment),
    employmentType: normalizeEmploymentType(slot.employment_type),
    location: normalizeLocation(slot.location),
    isRest,
    // [] means "no split configured" - i.e. one undivided pool of `capacity`,
    // which is how every slot behaved before waves were persisted.
    bookingWaves: parseStoredWaves(slot.booking_waves),
    createdAt: slot.created_at,
    updatedAt: slot.updated_at,
    current_bookings: currentBookings,
    currentBookings,
    bookings,
  };
}

function mapBooking(row: any) {
  return {
    ...row,
    id: row.id,
    slotId: row.slot_id,
    userId: row.user_id,
    bookedAt: row.booked_at,
    date: displayDate(row.date),
    startTime: row.is_rest ? 'Амралт' : displayTime(row.start_time),
    endTime: row.is_rest ? 'Амралт' : displayTime(row.end_time),
    duration: Number(resolveSlotDurationHours(row).toFixed(2)),
    capacity: Number(row.capacity || 0),
    bookingOpen: boolValue(row.booking_is_open),
    bookingOpenAt: displayDateTime(row.booking_open_at),
    bookingDeadline: displayDateTime(row.booking_deadline),
    segment: normalizeSegmentForDisplay(row.segment),
    employmentType: normalizeEmploymentType(row.employment_type),
    location: normalizeLocation(row.location),
    isRest: Boolean(row.is_rest),
    userName: row.user_name,
    userEmail: row.user_email,
    userCode: row.user_code,
  };
}

async function getUser(userId: string) {
  return db('users').where({ id: userId }).first();
}

async function getRuleForUser(user: any) {
  const segment = normalizeSegmentForDisplay(user.segment || user.lineType);
  const employmentType = normalizeEmploymentType(user.employment_type || user.employmentType);
  const location = normalizeLocation(user.location);
  const row = await db('shift_rule_settings')
    .where({ rule_type: 'weekly_shift_rules', segment, employment_type: employmentType, location })
    .first();
  if (!row?.value_text) return null;
  try { return JSON.parse(row.value_text); } catch { return null; }
}

function getWeekStart(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + diffToMonday);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hourKeyForSlot(slot: any) {
  if (slot.is_rest || slot.isRest) return 'rest';
  const duration = Math.round(resolveSlotDurationHours(slot));
  return duration >= 4 && duration <= 9 ? String(duration) : '';
}

async function validateUserWeeklyLimit(userId: string, targetSlot: any, excludeSlotId?: string) {
  const user = await getUser(userId);
  if (!user) return 'Хэрэглэгч олдсонгүй';
  const rule = await getRuleForUser(user);
  if (!rule) return '';

  const hourCounts = rule.hourCounts || {};
  const targetDate = displayDate(targetSlot.date);
  const weekStart = getWeekStart(targetDate);
  const weekEnd = addDays(weekStart, 7);

  const rows = await db('slot_bookings')
    .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
    .where({ 'slot_bookings.user_id': userId, 'slot_bookings.status': 'confirmed' })
    .where('work_slots.date', '>=', weekStart)
    .where('work_slots.date', '<', weekEnd)
    .select('slot_bookings.slot_id', 'work_slots.duration', 'work_slots.is_rest', 'work_slots.start_time', 'work_slots.end_time');

  const filtered = rows.filter((row: any) => row.slot_id !== excludeSlotId);

  const targetHourKey = hourKeyForSlot(targetSlot);
  if (targetHourKey && Object.prototype.hasOwnProperty.call(hourCounts, targetHourKey)) {
    // Only enforce a limit for a duration the admin has EXPLICITLY set a
    // count for. A duration that's simply absent from hourCounts (never
    // configured for this segment/type/location) is NOT restricted -
    // previously ANY configured rule implicitly blocked every duration
    // that wasn't listed, which silently broke bookings whenever a week's
    // schedule introduced a shift length the admin hadn't touched yet.
    const maxForHour = Number(hourCounts[targetHourKey] || 0);
    const currentForHour = filtered.filter((row: any) => hourKeyForSlot(row) === targetHourKey).length;
    if (maxForHour === 0) {
      return targetHourKey === 'rest' ? 'Амралтын өдөр сонгох боломжгүй.' : `${targetHourKey} цагтай хуваарь сонгох боломжгүй.`;
    }
    if (currentForHour + 1 > maxForHour) {
      return targetHourKey === 'rest'
        ? `Амралтын өдрийг ${maxForHour}-с олон сонгох боломжгүй.`
        : `${targetHourKey} цагтай хуваарийг ${maxForHour}-с олон сонгох боломжгүй.`;
    }
  }

  return '';
}

async function createNotification(payload: { title: string; content: string; authorId?: string | null; targetUserId?: string | null; relatedEntityType?: string; relatedEntityId?: string; type?: string }) {
  await db('notifications').insert({
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

router.get('/bookings', authenticate, async (req: any, res) => {
  try {
    let query = db('slot_bookings')
      .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
      .leftJoin('users', 'slot_bookings.user_id', '=', 'users.id')
      .where('slot_bookings.status', 'confirmed')
      .select(
        'slot_bookings.id',
        'slot_bookings.slot_id',
        'slot_bookings.user_id',
        'slot_bookings.booked_at',
        'slot_bookings.status',
        'work_slots.date',
        'work_slots.start_time',
        'work_slots.end_time',
        'work_slots.duration',
        'work_slots.capacity',
        'work_slots.booking_open_at',
        'work_slots.booking_is_open',
        'work_slots.booking_deadline',
        'work_slots.segment',
        'work_slots.employment_type',
        'work_slots.location',
        'work_slots.is_rest',
        // Prefer the live users table, falling back to the snapshot stored
        // on the booking itself if the user account was deleted - keeps
        // historical schedule records meaningful after account removal.
        db.raw('COALESCE(users.name, slot_bookings.user_name) as user_name'),
        'users.email as user_email',
        db.raw('COALESCE(users.code, slot_bookings.user_code) as user_code'),
      );

    if (req.user.role === 'csr') query = query.where('slot_bookings.user_id', req.user.id);

    const bookings = await query.orderBy('work_slots.date', 'asc').orderBy('work_slots.start_time', 'asc');
    res.json(bookings.map(mapBooking));
  } catch (err) {
    console.error('Get bookings error:', err);
    captureError('slots: Get bookings error:', err);
    res.status(500).json({ error: 'Захиалгууд татахад алдаа гарлаа' });
  }
});

router.get('/my-bookings', authenticate, async (req: any, res) => {
  try {
    const bookings = await db('slot_bookings')
      .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
      .where({ 'slot_bookings.user_id': req.user.id, 'slot_bookings.status': 'confirmed' })
      // NOT select('slot_bookings.*','work_slots.*'): both tables have `id`,
      // `created_at` and `updated_at`, so work_slots.id overwrote
      // slot_bookings.id and mapBooking() returned the SLOT id as the
      // booking id.
      .select(
        'slot_bookings.id as id',
        'slot_bookings.slot_id',
        'slot_bookings.user_id',
        'slot_bookings.booked_at',
        'slot_bookings.status',
        'slot_bookings.user_name',
        'slot_bookings.user_code',
        'work_slots.date',
        'work_slots.start_time',
        'work_slots.end_time',
        'work_slots.duration',
        'work_slots.capacity',
        'work_slots.booking_open_at',
        'work_slots.booking_is_open',
        'work_slots.booking_deadline',
        'work_slots.segment',
        'work_slots.employment_type',
        'work_slots.location',
        'work_slots.is_rest',
      )
      .orderBy('work_slots.date', 'asc')
      .orderBy('work_slots.start_time', 'asc');
    res.json(bookings.map(mapBooking));
  } catch (err) {
    console.error('Get my bookings error:', err);
    captureError('slots: Get my bookings error:', err);
    res.status(500).json({ error: 'Миний захиалга татахад алдаа гарлаа' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/slots - the single hottest endpoint in the whole app.
//
// Every open dashboard polls it in the background, so during a booking rush
// a few hundred clients ask for THE SAME data within the same second. It
// used to run two full table reads per request and serialise the entire
// schedule again for each one, on a single-vCPU App Service instance.
//
// Three changes keep the data just as fresh while removing almost all of
// that cost:
//
//  1. One shared, short-lived cache of the enriched slot list. Concurrent
//     misses are coalesced ("single flight") so 200 simultaneous requests
//     arriving right after the cache expires still produce exactly ONE pair
//     of database queries, not 200.
//  2. The JSON body is rendered once per distinct audience (a CSR only ever
//     sees slots matching their own segment / employment type / location)
//     and reused, instead of being rebuilt per request.
//  3. An ETag lets unchanged polls answer with an empty 304 instead of
//     resending the whole schedule. The schedule only changes when an admin
//     edits it or someone books, so the vast majority of polls are 304s.
//
// Any write that changes slots or bookings calls invalidateSlotsCache(), so
// a booking is visible to everyone on their very next poll - the cache TTL
// never delays a real change.
// ---------------------------------------------------------------------------

const SLOTS_CACHE_TTL_MS = Number(process.env.SLOTS_CACHE_TTL_MS || 5000);

interface SlotsCacheState {
  expiresAt: number;
  version: number;
  fingerprint: string;
  slots: any[];
  rendered: Map<string, string>;
}

let slotsCacheState: SlotsCacheState | null = null;
let slotsCacheVersion = 0;
let slotsInFlight: Promise<SlotsCacheState> | null = null;

export function invalidateSlotsCache() {
  slotsCacheState = null;
}

async function loadEnrichedSlots(): Promise<any[]> {
  const wavesEnabled = await hasBookingWaveColumns();
  const slots = await db('work_slots').orderBy('date', 'asc').orderBy('start_time', 'asc');

  // Fetch all confirmed bookings for all slots in ONE query instead of one
  // query per slot (previously N+1: 1 query for the slot list + 1 query
  // per individual slot). For a month view with hundreds of slots this
  // turns hundreds of DB round-trips into just 2.
  const slotIds = slots.map((s: any) => s.id);
  const allBookings = slotIds.length
    ? await db('slot_bookings')
        .leftJoin('users', 'slot_bookings.user_id', '=', 'users.id')
        .whereIn('slot_bookings.slot_id', slotIds)
        .where('slot_bookings.status', 'confirmed')
        .select(
          'slot_bookings.id',
          'slot_bookings.slot_id',
          'slot_bookings.user_id',
          'slot_bookings.booked_at',
          // Prefer the live users table (covers name changes etc for
          // still-active accounts), falling back to the snapshot stored
          // on the booking itself if the user account was deleted.
          db.raw('COALESCE(users.name, slot_bookings.user_name) as user_name'),
          'users.email as user_email',
          db.raw('COALESCE(users.code, slot_bookings.user_code) as user_code'),
          'users.segment as user_segment',
          'users.employment_type as user_employment_type',
          'users.location as user_location',
          ...(wavesEnabled ? ['slot_bookings.booking_wave_id'] : []),
        )
    : [];

  const bookingsBySlotId = new Map<string, any[]>();
  for (const b of allBookings as any[]) {
    const key = String(b.slot_id);
    if (!bookingsBySlotId.has(key)) bookingsBySlotId.set(key, []);
    bookingsBySlotId.get(key)!.push({
      id: b.id,
      userId: b.user_id,
      userName: b.user_name,
      userEmail: b.user_email,
      userCode: b.user_code,
      bookedAt: b.booked_at,
      bookingWaveId: b.booking_wave_id || null,
      segment: b.user_segment,
      employmentType: b.user_employment_type,
      location: b.user_location,
    });
  }

  return slots.map((slot: any) => {
    const bookings = bookingsBySlotId.get(String(slot.id)) || [];
    return mapSlot(slot, bookings.length, bookings);
  });
}

async function getSlotsCache(): Promise<SlotsCacheState> {
  const now = Date.now();
  if (slotsCacheState && slotsCacheState.expiresAt > now) return slotsCacheState;

  // Single flight: whoever gets here first does the database work and every
  // other concurrent request awaits that same promise.
  if (slotsInFlight) return slotsInFlight;

  slotsInFlight = (async () => {
    try {
      const enriched = await withDbRetry(loadEnrichedSlots, { label: 'GET /api/slots' });
      const fingerprint = JSON.stringify(enriched);

      // Only bump the version when the data actually changed. A stable
      // version keeps the ETag stable, which is what lets a quiet poll
      // answer 304 instead of resending the whole schedule.
      const previous = slotsCacheState;
      const changed = !previous || previous.fingerprint !== fingerprint;
      if (changed) slotsCacheVersion += 1;

      slotsCacheState = {
        expiresAt: Date.now() + SLOTS_CACHE_TTL_MS,
        version: slotsCacheVersion,
        fingerprint,
        slots: enriched,
        rendered: changed ? new Map() : previous!.rendered,
      };
      return slotsCacheState;
    } finally {
      slotsInFlight = null;
    }
  })();

  return slotsInFlight;
}

// A CSR's dashboard discards every slot that does not match their own
// segment / employment type / location, so sending those slots is pure
// waste - for a CSR this is typically well over 80% of the payload. Admins
// and superadmins manage the whole schedule and still receive everything.
function audienceKeyFor(user: any): string {
  if (user?.role !== 'csr') return 'all';
  const segment = String(user.segment || '').trim();
  const employmentType = normalizeEmploymentType(user.employment_type ?? user.employmentType);
  const location = normalizeLocation(user.location);
  return `csr:${segment}|${employmentType}|${location}`;
}

function filterSlotsForAudience(slots: any[], user: any): any[] {
  if (user?.role !== 'csr') return slots;
  const employmentType = normalizeEmploymentType(user.employment_type ?? user.employmentType);
  const location = normalizeLocation(user.location);
  return slots
    .filter((slot: any) =>
      segmentsMatch(slot.segment, user.segment) &&
      normalizeEmploymentType(slot.employmentType) === employmentType &&
      normalizeLocation(slot.location) === location
    )
    // A CSR needs to see WHO is on a shift with them - the roster view shows
    // colleagues' names. It does not need their email addresses, which were
    // being handed to every CSR for every booking in their segment.
    .map((slot: any) => ({
      ...slot,
      bookings: (slot.bookings || []).map((booking: any) => {
        const { userEmail, ...rest } = booking;
        return rest;
      }),
    }));
}

router.get('/', authenticate, async (req: any, res) => {
  try {
    // A CSR's audience depends on fields the auth middleware does not carry
    // (segment / employment type / location), so read the full row once.
    // For admins nothing extra is needed.
    let audienceUser = req.user;
    if (req.user?.role === 'csr') {
      const profile = await withDbRetry(() => getUser(req.user.id), { label: 'GET /api/slots:user' });
      if (!profile) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
      audienceUser = { ...req.user, ...profile, role: req.user.role };
    }

    const cache = await getSlotsCache();
    const key = audienceKeyFor(audienceUser);
    const etag = `W/"slots-${cache.version}-${key}"`;

    // Tell the browser to always revalidate (so a change is never missed)
    // but to keep the body around, so an unchanged poll costs one tiny
    // conditional request instead of a full schedule download.
    res.setHeader('Cache-Control', 'no-cache, private');
    res.setHeader('Vary', 'Authorization');
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    let body = cache.rendered.get(key);
    if (body === undefined) {
      body = JSON.stringify(filterSlotsForAudience(cache.slots, audienceUser));
      cache.rendered.set(key, body);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(body);
  } catch (err) {
    console.error('Get slots error:', err);
    captureError('GET /api/slots', err);
    res.status(500).json({ error: 'Слотууд татахад алдаа гарлаа' });
  }
});

router.post('/', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { date, startTime, endTime, start_time, end_time, capacity, bookingDeadline, booking_deadline, bookingOpen, booking_open, bookingOpenAt, booking_open_at, segment, employmentType, employment_type, location, isRest, is_rest } = req.body;
  const finalCapacity = Math.max(1, Number(capacity) || 1);
  const rest = Boolean(isRest || is_rest || startTime === 'Амралт' || start_time === 'Амралт');
  const sqlSlotDate = toSqlDate(date);
  const sqlStartTime = rest ? '00:00:00' : normalizeTime(start_time || startTime);
  const sqlEndTime = rest ? '00:00:00' : normalizeTime(end_time || endTime);
  const sqlDeadline = toSqlDateTime(booking_deadline || bookingDeadline, new Date(Date.now() + 24 * 60 * 60 * 1000));
  const sqlOpenAt = toSqlDateTime(booking_open_at || bookingOpenAt);
  // Same fix as resolveBookingWindow: a scheduled future open time (sqlOpenAt)
  // itself means booking should be considered "configured/open" so it gets
  // persisted correctly - otherwise booking_is_open would stay false and
  // the slot would never actually open for CSRs once the scheduled time
  // arrives. The live per-request check in the booking handler (comparing
  // booking_open_at to now()) is what actually gates early access.
  const finalBookingOpen = boolValue(booking_open ?? bookingOpen) || Boolean(sqlOpenAt);
  // Segments are fully separate business units (Prepaid, Postpaid, VIP,
  // etc.) - there is no "applies to everyone" wildcard. A shift must always
  // specify exactly which segment it belongs to; we no longer silently
  // default a missing segment to "All", since that made the slot bookable
  // by CSRs from every segment and also made it disappear from the
  // segment-filtered schedule UI (no dropdown option ever shows "All").
  const finalSegment = String(segment || '').trim();
  const finalEmploymentType = normalizeEmploymentType(employment_type || employmentType);
  const finalLocation = normalizeLocation(location);

  if (!sqlSlotDate || !sqlDeadline || (!rest && (!sqlStartTime || !sqlEndTime))) {
    return res.status(400).json({ error: 'Огноо болон цагийн формат буруу байна' });
  }

  if (!finalSegment) {
    return res.status(400).json({ error: 'Segment заавал сонгосон байх ёстой' });
  }

  try {
    const duplicateSlot = await db('work_slots')
      .where({ date: sqlSlotDate, start_time: sqlStartTime, end_time: sqlEndTime, segment: finalSegment, employment_type: finalEmploymentType, location: finalLocation, is_rest: rest ? 1 : 0 })
      .first();

    const duration = rest ? 0 : calculateDuration(sqlStartTime, sqlEndTime, req.body.duration);
    if (duplicateSlot) {
      await db('work_slots').where({ id: duplicateSlot.id }).update({ capacity: finalCapacity, booking_open_at: sqlOpenAt, booking_is_open: finalBookingOpen ? 1 : 0, booking_deadline: finalBookingOpen ? sqlDeadline : null, updated_at: db.fn.now() });
      return res.json({ id: duplicateSlot.id });
    }

    const id = uuidv4();
    await db('work_slots').insert({
      id,
      date: sqlSlotDate,
      start_time: sqlStartTime,
      end_time: sqlEndTime,
      duration,
      capacity: finalCapacity,
      booking_open_at: sqlOpenAt,
      booking_is_open: finalBookingOpen ? 1 : 0,
      booking_deadline: finalBookingOpen ? sqlDeadline : null,
      segment: finalSegment,
      employment_type: finalEmploymentType,
      location: finalLocation,
      is_rest: rest ? 1 : 0,
    });
    await logAction(
      (req as any).user?.id,
      'CREATE_SLOT',
      'work_slots',
      id,
      `${displayDate(sqlSlotDate)} ${rest ? 'Амралт' : `${displayTime(sqlStartTime)}-${displayTime(sqlEndTime)}`} ` +
      `${finalSegment}/${finalEmploymentType}/${finalLocation} capacity=${finalCapacity}`,
      req,
    );
    res.status(201).json({ id });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // The unique index did its job. "This shift already exists" is an
      // answer the admin can act on; a 500 is not.
      return res.status(409).json({
        error: 'Энэ ээлж аль хэдийн үүссэн байна (ижил өдөр, цаг, segment, ажлын төрөл, байршил).',
      });
    }
    console.error('Create slot error:', err);
    captureError('slots: Create slot error:', err);
    res.status(500).json({ error: 'Слот үүсгэхэд алдаа гарлаа' });
  }
});

router.post('/sync-schedules', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { schedules, dateKeys, scope } = req.body;
  if (!schedules || typeof schedules !== 'object') return res.status(400).json({ error: 'schedules шаардлагатай' });
  const wavesEnabled = await hasBookingWaveColumns();
  const keys = Array.isArray(dateKeys) && dateKeys.length ? dateKeys : Object.keys(schedules);
  const syncScope = scope && typeof scope === 'object'
    ? {
        location: normalizeLocation(scope.location),
        segment: String(scope.segment || '').trim(),
        employmentType: normalizeEmploymentType(scope.employmentType),
      }
    : null;
  let synced = 0;
  let deleted = 0;
  // Shifts the payload contained but which could not be stored (unparseable
  // time, missing segment). These used to be dropped with only a
  // console.warn, so the admin saw "saved" for a save that lost rows.
  const skipped: string[] = [];
  const deletedDescriptions: string[] = [];
  const keptBookedSlots: string[] = [];
  let skippedUnscoped = 0;
  try {
    await db.transaction(async (trx) => {
      for (const rawDateKey of keys) {
        const dateKey = toSqlDate(rawDateKey);
        if (!dateKey) continue;

        const day = schedules[dateKey] || schedules[rawDateKey] || { shifts: [] };
        const incomingSlots: any[] = [];
        for (const shift of day?.shifts || []) {
          const rest = shift.time === 'Амралт' || shift.isRest || shift.is_rest;
          let startTime = '00:00';
          let endTime = '00:00';
          const rawShiftTime = String(shift.time || shift.startTime || shift.start_time || '').trim();

          if (!rest) {
            const parsed = parseShiftTimeRange(rawShiftTime);
            if (parsed) {
              startTime = parsed.startTime;
              endTime = parsed.endTime;
            } else if (String(shift.startTime || shift.start_time || '').trim() && String(shift.endTime || shift.end_time || '').trim()) {
              startTime = String(shift.startTime || shift.start_time).trim();
              endTime = String(shift.endTime || shift.end_time).trim();
            } else {
              console.warn('Skipping invalid work slot time during sync:', { dateKey, rawShiftTime, shift });
              skipped.push(`${dateKey}: цагийн формат буруу (${rawShiftTime || 'хоосон'})`);
              continue;
            }
          }

          // No "All" wildcard fallback here either - a shift missing its
          // segment is invalid data and gets skipped (like an invalid time
          // range below), rather than silently becoming visible to every
          // segment's CSRs and invisible in the segment-filtered UI.
          const segment = String(shift.segment || '').trim();
          if (!segment) {
            console.warn('Skipping work slot with missing segment during sync:', { dateKey, shift });
            skipped.push(`${dateKey}: segment сонгогдоогүй (${rawShiftTime || 'Амралт'})`);
            continue;
          }
          const employmentType = normalizeEmploymentType(shift.employmentType || shift.employment_type);
          const location = normalizeLocation(shift.location);
          const sqlStart = rest ? '00:00:00' : normalizeTime(startTime);
          const sqlEnd = rest ? '00:00:00' : normalizeTime(endTime);
          if (!rest && (!sqlStart || !sqlEnd)) {
            console.warn('Skipping work slot with invalid normalized time during sync:', { dateKey, startTime, endTime, shift });
            skipped.push(`${dateKey}: цаг танигдсангүй (${startTime}-${endTime})`);
            continue;
          }
          const bookingWindow = resolveBookingWindow(day, shift);
          const storedWaves = normalizeWavesForStorage(shift.bookingWaves);
          // Capacity: Амралт-ын хувьд admin хэдэн хүн авахыг тоогоор
          // тохируулдаг тул тэр тоог (totalSlots/capacity) шууд хэрэглэнэ.
          // Хэрэв тохируулаагүй бол хамгийн багадаа 1 (ажлын shift-тэй адил).
          const capacity = Math.max(1, Number(shift.totalSlots || shift.capacity || 1) || 1);
          incomingSlots.push({
            id: toValidUuidOrNew(shift.id),
            date: dateKey,
            start_time: sqlStart,
            end_time: sqlEnd,
            duration: rest ? 0 : calculateDuration(sqlStart, sqlEnd),
            capacity,
            booking_open_at: bookingWindow.bookingOpenAt,
            booking_is_open: bookingWindow.bookingOpen ? 1 : 0,
            booking_deadline: bookingWindow.bookingDeadline,
            segment,
            employment_type: employmentType,
            location,
            is_rest: rest ? 1 : 0,
            // The admin's morning/evening split used to be thrown away on
            // every save and regenerated on every read.
            ...(wavesEnabled ? { booking_waves: storedWaves.length > 0 ? JSON.stringify(storedWaves) : null } : {}),
            updated_at: trx.fn.now(),
          });
        }

        const existingRows = await trx('work_slots').where({ date: dateKey }).select('*');
        const existingById = new Map(existingRows.map((row: any) => [String(row.id), row]));
        const existingByIdentity = new Map(existingRows.map((row: any) => [slotIdentity(row), row]));
        const keptIds = new Set<string>();

        for (const payload of incomingSlots) {
          try {
            const existing = existingById.get(String(payload.id)) || existingByIdentity.get(slotIdentity(payload));
            if (existing) {
              const { id: _, ...updateData } = payload;
              await trx('work_slots').where({ id: existing.id }).update(updateData);
              keptIds.add(String(existing.id));
            } else {
              try {
                await trx('work_slots').insert({ ...payload, created_at: trx.fn.now() });
                keptIds.add(String(payload.id));
              } catch (insertErr: any) {
                // work_slots now carries a unique index on the shift's
                // natural key. Another admin saving an overlapping schedule
                // can therefore insert the same shift between our SELECT
                // above and this INSERT. That is a race, not a conflict of
                // intent - both sides want this shift to exist - so resolve
                // it the way the non-racing path would: take their row and
                // apply our update to it. Rethrowing would abort the entire
                // transaction and lose an admin's whole save.
                if (!isDuplicateKeyError(insertErr)) throw insertErr;
                const raced = await trx('work_slots')
                  .where({
                    date: payload.date,
                    start_time: payload.start_time,
                    end_time: payload.end_time,
                    segment: payload.segment,
                    employment_type: payload.employment_type,
                    location: payload.location,
                    is_rest: payload.is_rest,
                  })
                  .first();
                if (!raced) throw insertErr;
                const { id: _raced, ...updateData } = payload;
                await trx('work_slots').where({ id: raced.id }).update(updateData);
                keptIds.add(String(raced.id));
              }
            }
            synced += 1;
          } catch (slotErr: any) {
            console.error('Slot operation failed:', {
              date: dateKey,
              payload,
              error: slotErr.message
            });
            throw slotErr; // Rethrow to abort transaction
          }
        }

        // ------------------------------------------------------------------
        // Reconciliation deletes. This is the most destructive code in the
        // application and it has two hard rules.
        //
        // RULE 1: no scope, no deletion.
        // A sync request carries every shift for a date across ALL segments,
        // employment types and locations. `scope` says which slice of that
        // the admin was actually editing. Without it we cannot tell "the
        // admin removed this shift" from "this shift belongs to a slice the
        // admin never loaded", so treating everything unmatched as stale
        // deleted other segments' entire schedules. That fired whenever
        // `activeSegmentView` had not been populated yet (the segments fetch
        // is async) and unconditionally on a segment rename, which passes no
        // scope at all. Deleting nothing is always the safe answer here.
        //
        // RULE 2: never silently delete a shift somebody has booked.
        // Identity matching is date|start|end|segment|type|location|is_rest,
        // so merely editing a shift's TIME made the old row unmatched - and
        // deleting it took every confirmed booking on it with no audit row,
        // no notification and no way to find out who lost their shift.
        // Booked shifts are now kept and reported back to the admin instead.
        // ------------------------------------------------------------------
        if (!syncScope?.segment) {
          if (existingRows.some((row: any) => !keptIds.has(String(row.id)))) {
            skippedUnscoped += 1;
          }
          continue;
        }

        const staleRows = existingRows.filter((row: any) => {
          if (keptIds.has(String(row.id))) return false;
          return normalizeLocation(row.location) === syncScope.location
            && String(row.segment || '').trim() === syncScope.segment
            && normalizeEmploymentType(row.employment_type) === syncScope.employmentType;
        });
        if (staleRows.length === 0) continue;

        const staleIds = staleRows.map((row: any) => String(row.id));
        const bookedRows = await trx('slot_bookings')
          .whereIn('slot_id', staleIds)
          .where({ status: 'confirmed' })
          .select('slot_id');
        const bookedSlotIds = new Set(bookedRows.map((row: any) => String(row.slot_id)));

        const deletableRows = staleRows.filter((row: any) => !bookedSlotIds.has(String(row.id)));
        for (const row of staleRows) {
          if (!bookedSlotIds.has(String(row.id))) continue;
          keptBookedSlots.push(
            `${dateKey} ${displayTime(row.start_time)}-${displayTime(row.end_time)}`,
          );
        }

        if (deletableRows.length === 0) continue;
        const deletableIds = deletableRows.map((row: any) => row.id);
        try {
          await trx('trade_requests')
            .whereIn('sender_slot_id', deletableIds)
            .orWhereIn('receiver_slot_id', deletableIds)
            .delete();
          // Only cancelled/auto-assigned rows can remain here - confirmed
          // ones were excluded above - but they still have to go before the
          // slot itself can be removed.
          await trx('slot_bookings').whereIn('slot_id', deletableIds).delete();
          await trx('work_slots').whereIn('id', deletableIds).delete();
          deleted += deletableRows.length;
          deletedDescriptions.push(
            ...deletableRows.map((row: any) =>
              `${dateKey} ${displayTime(row.start_time)}-${displayTime(row.end_time)}`,
            ),
          );
        } catch (staleErr: any) {
          console.error('Stale rows deletion failed:', {
            date: dateKey,
            staleIds: deletableIds,
            error: staleErr.message
          });
          throw staleErr;
        }
      }
    });

    if (deleted > 0) {
      await logAction(
        req.user.id,
        'SYNC_SCHEDULE_DELETED_SLOTS',
        'work_slots',
        null,
        `Removed ${deleted} unbooked shift(s) in scope ` +
        `${syncScope?.location}/${syncScope?.segment}/${syncScope?.employmentType}: ` +
        `${deletedDescriptions.slice(0, 40).join(', ')}` +
        `${deletedDescriptions.length > 40 ? ` (+${deletedDescriptions.length - 40} more)` : ''}`,
        req,
      );
    }

    res.json({
      synced,
      deleted,
      skipped,
      // Shifts the admin's payload no longer contained but which somebody has
      // already booked. They were deliberately kept; the client surfaces this
      // so the admin can remove the person first if the removal was intended.
      keptBookedSlots,
      // Dates where nothing could be reconciled because the request carried
      // no editing scope.
      skippedUnscopedDates: skippedUnscoped,
    });
  } catch (err: any) {
    console.error('Sync schedules FATAL error:', err);
    captureError('slots: Sync schedules FATAL error:', err);
    // This route already requires authenticate + authorize(['admin','superadmin']),
    // so it's safe to always surface the real error message here (not just in
    // non-production) - it helps admins self-diagnose DB issues without
    // needing Azure Portal / Log Stream access.
    res.status(500).json({
      error: 'Хуваарь DB-д хадгалахад алдаа гарлаа.',
      details: err?.message || String(err),
    });
  }
});

router.delete('/:id', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
  try {
    // Read the shift and its bookings BEFORE destroying them. This endpoint
    // deletes a shift, everyone booked onto it and any trade referencing it,
    // and until now left nothing behind to say what was lost or who did it -
    // which is precisely why the schedule-save data loss went unnoticed for
    // so long.
    const slot = await db('work_slots').where({ id: req.params.id }).first();
    const victims = await db('slot_bookings')
      .leftJoin('users', 'slot_bookings.user_id', 'users.id')
      .where('slot_bookings.slot_id', req.params.id)
      .andWhere('slot_bookings.status', 'confirmed')
      .select('users.email as email', 'users.name as name');

    await db('trade_requests')
      .where({ sender_slot_id: req.params.id })
      .orWhere({ receiver_slot_id: req.params.id })
      .delete();
    await db('slot_bookings').where({ slot_id: req.params.id }).delete();
    await db('work_slots').where({ id: req.params.id }).delete();

    await logAction(
      (req as any).user?.id,
      'DELETE_SLOT',
      'work_slots',
      req.params.id,
      slot
      ? `${displayDate(slot.date)} ${boolValue(slot.is_rest) ? 'Амралт' : `${displayTime(slot.start_time)}-${displayTime(slot.end_time)}`} ` +
      `${slot.segment}/${slot.employment_type}/${slot.location} | ` +
      `${victims.length} booking(s) removed: ${victims.map((v: any) => v.email || v.name || '?').slice(0, 30).join(', ')}` +
      `${victims.length > 30 ? ` (+${victims.length - 30} more)` : ''}`
      : 'slot not found (already deleted)',
      req,
    );
    res.json({ message: 'Слот устгагдлаа' });
  } catch (err) {
    console.error('Delete slot error:', err);
    captureError('slots: Delete slot error:', err);
    res.status(500).json({ error: 'Слот устгахад алдаа гарлаа' });
  }
});

router.delete('/:slotId/bookings/:userId', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
  const { slotId, userId } = req.params;
  try {
    const target = await db('users').where({ id: userId }).first();
    const slot = await db('work_slots').where({ id: slotId }).first();

    const deleted = await db('slot_bookings')
      .where({ slot_id: slotId, user_id: userId, status: 'confirmed' })
      .delete();

    if (!deleted) {
      return res.status(404).json({ error: 'Захиалга олдсонгүй' });
    }

    // The CSR is not notified of this, so the audit entry is the only record
    // that their shift was taken away rather than lost to a bug.
    await logAction(
      (req as any).user?.id,
      'REMOVE_BOOKING',
      'slot_bookings',
      slotId,
      `${target?.email || userId} removed from ` +
      `${slot ? `${displayDate(slot.date)} ${displayTime(slot.start_time)}-${displayTime(slot.end_time)}` : slotId}`,
      req,
    );
    res.json({ message: 'Захиалга хасагдлаа' });
  } catch (err) {
    console.error('Remove booking error:', err);
    captureError('slots: Remove booking error:', err);
    res.status(500).json({ error: 'Захиалга хасахад алдаа гарлаа' });
  }
});

const bookHandler = async (req: any, res: any) => {
  const slot_id = req.params.slotId || req.body.slot_id || req.body.slotId;
  const userId = req.user.id;
  const editBookingId = req.body.editBookingId || req.body.booking_id || req.body.bookingId;
  const requestedWaveId = req.body.bookingWaveId ? String(req.body.bookingWaveId).slice(0, 64) : null;
  if (!slot_id) return res.status(400).json({ error: 'Слот ID шаардлагатай' });

  const wavesEnabled = await hasBookingWaveColumns();

  try {
    const slot = await db('work_slots').where({ id: slot_id }).first();
    if (!slot) return res.status(404).json({ error: 'Слот олдсонгүй' });
    if (!boolValue(slot.booking_is_open)) {
      return res.status(400).json({ error: 'Захиалга хаалттай байна' });
    }
    if (slot.booking_open_at && new Date().getTime() < new Date(slot.booking_open_at).getTime()) {
      return res.status(400).json({ error: 'Захиалга эхлэх хугацаа болоогүй байна' });
    }
    if (slot.booking_deadline && new Date().getTime() > new Date(slot.booking_deadline).getTime()) {
      return res.status(400).json({ error: 'Захиалга хийх хугацаа дууссан байна' });
    }
    // Editing an EXISTING confirmed booking has a stricter cutoff than making
    // a brand new booking: edits must happen at least 30 minutes before the
    // booking deadline, not right up to it. This gives admins a small buffer
    // after the deadline closes before the schedule is treated as final.
    if (editBookingId && slot.booking_deadline) {
      const editCutoff = new Date(slot.booking_deadline).getTime() - 30 * 60 * 1000;
      if (Date.now() > editCutoff) {
        return res.status(400).json({ error: 'Захиалга хаагдахаас 30 минутын өмнө хүртэл л засах боломжтой' });
      }
    }

    const user = await getUser(userId);
    if (!user) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    // No "All" wildcard bypass - segments are fully separate business
    // units, so a CSR may only book a slot whose segment exactly matches
    // their own segment. (Previously slot.segment === 'All' let ANY CSR
    // from ANY segment book it, which is not the intended business rule.)
    if (!segmentsMatch(slot.segment, user.segment)) {
      await logAction(userId, 'BOOKING_REJECTED', 'work_slots', slot_id, `${user.email}: segment mismatch (slot=${slot.segment}, user=${user.segment})`, req);
      return res.status(403).json({ error: 'Өөр segment-ийн хуваарь сонгох боломжгүй' });
    }
    if (normalizeEmploymentType(slot.employment_type) !== normalizeEmploymentType(user.employment_type)) {
      await logAction(userId, 'BOOKING_REJECTED', 'work_slots', slot_id, `${user.email}: employment type mismatch (slot=${slot.employment_type}, user=${user.employment_type})`, req);
      return res.status(403).json({ error: 'Full/Part төрөл таарахгүй байна' });
    }
    if (normalizeLocation(slot.location) !== normalizeLocation(user.location)) {
      await logAction(userId, 'BOOKING_REJECTED', 'work_slots', slot_id, `${user.email}: location mismatch (slot=${slot.location}, user=${user.location})`, req);
      return res.status(403).json({ error: 'Өөр байршлын (location) хуваарь сонгох боломжгүй' });
    }

    const existingOnSameDay = await db('slot_bookings')
      .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
      .where({ 'slot_bookings.user_id': userId, 'work_slots.date': slot.date, 'slot_bookings.status': 'confirmed' })
      .select('slot_bookings.*')
      .first();

    if (existingOnSameDay && existingOnSameDay.slot_id !== slot_id && !editBookingId) {
      return res.status(400).json({ error: 'Энэ өдөр аль хэдийн захиалга хийсэн байна' });
    }

    const ruleError = await validateUserWeeklyLimit(userId, slot, editBookingId ? existingOnSameDay?.slot_id : undefined);
    if (ruleError) {
      await logAction(
        userId,
        'BOOKING_REJECTED',
        'work_slots',
        slot_id,
        `${user.email} (${user.segment || '-'}, ${user.employment_type || '-'}, ${user.location || '-'}): ${ruleError} | slot ${displayDate(slot.date)} ${displayTime(slot.start_time)}-${displayTime(slot.end_time)}`,
        req,
      );
      return res.status(400).json({ error: ruleError });
    }

    const bookingResult = await db.transaction(async trx => {
      // Row-level locking to close the booking race condition:
      // - Locking the target work_slot row serializes concurrent booking
      //   attempts BY DIFFERENT USERS for this same slot, so the capacity
      //   check below can no longer be beaten by a simultaneous request
      //   (previously two requests could both read count < capacity and
      //   both insert, exceeding capacity).
      // - Locking the acting user's row serializes concurrent booking
      //   attempts BY THE SAME USER (e.g. a double-click or retry), so they
      //   can't create two conflicting same-day bookings.
      // Lock order is always work_slots -> users, consistently, to avoid deadlocks.
      // On sqlite (local dev) forUpdate() is a safe no-op; on Azure SQL (mssql)
      // it compiles to "WITH (UPDLOCK)".
      await trx('work_slots').where({ id: slot_id }).forUpdate().first();
      await trx('users').where({ id: userId }).forUpdate().first();

      const currentBooking = await trx('slot_bookings')
        .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
        .where({ 'slot_bookings.user_id': userId, 'work_slots.date': slot.date, 'slot_bookings.status': 'confirmed' })
        .select('slot_bookings.*')
        .first();

      if (currentBooking && currentBooking.slot_id !== slot_id && !editBookingId) {
        return { status: 400, error: 'Энэ өдөр аль хэдийн захиалга хийсэн байна' };
      }

      const [{ count }] = await trx('slot_bookings').where({ slot_id, status: 'confirmed' }).count('id as count');
      if (Number(count) >= Number(slot.capacity) && (!currentBooking || currentBooking.slot_id !== slot_id)) {
        return { status: 400, error: 'Орон тоо дүүрсэн байна' };
      }

      // Wave quotas. `bookingWaveId` was sent by the client and silently
      // ignored, so the admin's morning/evening split enforced nothing. A
      // slot with no recorded waves is still one undivided pool, which is
      // how everything behaved before - so this only starts applying once an
      // admin actually saves a split.
      let resolvedWaveId: string | null = null;
      if (wavesEnabled) {
        const waves = parseStoredWaves(slot.booking_waves);
        if (waves.length > 0) {
          const wave = requestedWaveId
            ? waves.find((w) => w.id === requestedWaveId)
            : waves[0];
          if (!wave) {
            return { status: 400, error: 'Сонгосон захиалах эрх олдсонгүй' };
          }

          const now = Date.now();
          const waveOpenAt = wave.bookingOpenAt ? new Date(wave.bookingOpenAt).getTime() : NaN;
          const waveCloseAt = wave.bookingCloseAt ? new Date(wave.bookingCloseAt).getTime() : NaN;
          if (!wave.bookingOpen) {
            return { status: 400, error: `"${wave.name}" захиалга хаалттай байна` };
          }
          if (Number.isFinite(waveOpenAt) && now < waveOpenAt) {
            return { status: 400, error: `"${wave.name}" захиалга эхлэх хугацаа болоогүй байна` };
          }
          if (Number.isFinite(waveCloseAt) && now > waveCloseAt) {
            return { status: 400, error: `"${wave.name}" захиалгын хугацаа дууссан байна` };
          }

          const [{ count: waveCount }] = await trx('slot_bookings')
            .where({ slot_id, status: 'confirmed', booking_wave_id: wave.id })
            .count('id as count');
          const alreadyInThisWave = currentBooking
            && currentBooking.slot_id === slot_id
            && currentBooking.booking_wave_id === wave.id;
          if (!alreadyInThisWave && Number(waveCount) >= wave.slotLimit) {
            return { status: 400, error: `"${wave.name}" эрхийн орон тоо дүүрсэн байна` };
          }
          resolvedWaveId = wave.id;
        }
      }
      const waveFields = wavesEnabled ? { booking_wave_id: resolvedWaveId } : {};

      // slot_bookings carries UNIQUE(slot_id, user_id), and cancelling is a
      // SOFT delete (the row stays behind with status='cancelled', see
      // cancelHandler). So a user who cancels a shift still owns a row for
      // that (slot, user) pair. Inserting a fresh row - or moving another
      // booking onto that slot - therefore violated the unique constraint
      // and surfaced as a bare 500 "Захиалга хийхэд алдаа гарлаа": a CSR
      // could never retake a shift they had cancelled.
      //
      // The fix is to treat that leftover row as what it is - this user's
      // booking record for this slot - and revive it instead of creating a
      // second one.
      const leftoverForTargetSlot = await trx('slot_bookings')
        .where({ slot_id, user_id: userId })
        .whereNot({ status: 'confirmed' })
        .first();

      if (currentBooking) {
        // Moving an existing booking onto this slot. Any leftover cancelled
        // row for the target slot would collide with the update below, and
        // is pure history we are about to supersede.
        if (leftoverForTargetSlot && leftoverForTargetSlot.id !== currentBooking.id) {
          await trx('slot_bookings').where({ id: leftoverForTargetSlot.id }).delete();
        }
        await trx('slot_bookings').where({ id: currentBooking.id }).update({
          slot_id,
          booked_at: db.fn.now(),
          status: 'confirmed',
          // Refresh the snapshot so a renamed user stays correct on the row.
          user_name: user.name,
          user_code: user.code,
          ...waveFields,
        });
        return { id: currentBooking.id, edited: true };
      }

      if (leftoverForTargetSlot) {
        await trx('slot_bookings').where({ id: leftoverForTargetSlot.id }).update({
          booked_at: db.fn.now(),
          status: 'confirmed',
          user_name: user.name,
          user_code: user.code,
          ...waveFields,
        });
        return { id: leftoverForTargetSlot.id, created: true };
      }

      const id = uuidv4();
      await trx('slot_bookings').insert({
        id,
        slot_id,
        user_id: userId,
        status: 'confirmed',
        // Snapshot the user's name/code at booking time. If the user
        // account is later deleted, user_id becomes NULL (SET NULL FK) but
        // this row - and these identifying fields - remain, so historical
        // schedule reports stay meaningful.
        user_name: user.name,
        user_code: user.code,
        ...waveFields,
      });
      return { id, created: true };
    });

    if ('error' in bookingResult) {
      return res.status(bookingResult.status).json({ error: bookingResult.error });
    }

    // Bookings and cancellations are the two events every "but I DID book
    // it" dispute turns on, and neither left a trace. Only rejections were
    // logged, so the record contained every failure and no success.
    const slotLabel = `${displayDate(slot.date)} ` +
      `${boolValue(slot.is_rest) ? 'Амралт' : `${displayTime(slot.start_time)}-${displayTime(slot.end_time)}`}`;

    if ('edited' in bookingResult && bookingResult.edited) {
      await logAction(userId, 'BOOKING_EDITED', 'slot_bookings', bookingResult.id, `${user.email}: ${slotLabel}`, req);
      return res.json({ id: bookingResult.id, edited: true });
    }

    await logAction(userId, 'BOOKING_CREATED', 'slot_bookings', bookingResult.id, `${user.email}: ${slotLabel}`, req);
    res.status(201).json({ id: bookingResult.id });
  } catch (err) {
    console.error('Book slot error:', err);
    captureError('slots: Book slot error:', err);
    res.status(500).json({ error: 'Захиалга хийхэд алдаа гарлаа' });
  }
};

// The slot id comes in the body. A /:slotId/book alias existed for clients
// from before 2026-07-31, which sent it in the path; removed once no such
// client could plausibly still be open.
router.post('/book', authenticate, authorize(['csr']), bookHandler);
router.put('/bookings/:bookingId', authenticate, authorize(['csr']), async (req: any, res: any) => {
  req.body.bookingId = req.params.bookingId;
  return bookHandler(req, res);
});

const cancelHandler = async (req: any, res: any) => {
  const slot_id = req.params.slotId || req.body.slot_id || req.body.slotId;
  const booking_id = req.body.booking_id || req.body.bookingId;
  const userId = req.user.id;

  try {
    let booking;
    if (booking_id) booking = await db('slot_bookings').where({ id: booking_id, user_id: userId }).first();
    else if (slot_id) booking = await db('slot_bookings').where({ slot_id, user_id: userId, status: 'confirmed' }).first();
    if (!booking) return res.status(404).json({ error: 'Захиалга олдсонгүй' });

    const slot = await db('work_slots').where({ id: booking.slot_id }).first();
    if (slot?.booking_deadline && new Date().getTime() > new Date(slot.booking_deadline).getTime()) {
      return res.status(400).json({ error: 'Цуцлах хугацаа дууссан байна. Зөвхөн арилжаа хийх боломжтой.' });
    }

    const updated = await db('slot_bookings')
      .where({ id: booking.id, user_id: userId, status: 'confirmed' })
      .update({ status: 'cancelled' });

    if (!updated) {
      return res.status(404).json({ error: 'Захиалга олдсонгүй' });
    }
    await logAction(
      userId,
      'BOOKING_CANCELLED',
      'slot_bookings',
      booking.id,
      slot
      ? `${displayDate(slot.date)} ${boolValue(slot.is_rest) ? 'Амралт' : `${displayTime(slot.start_time)}-${displayTime(slot.end_time)}`}`
      : booking.slot_id,
      req,
    );
    res.json({ message: 'Захиалга цуцлагдлаа' });
  } catch (err) {
    console.error('Cancel booking error:', err);
    captureError('slots: Cancel booking error:', err);
    res.status(500).json({ error: 'Цуцлахад алдаа гарлаа' });
  }
};

router.post('/:slotId/cancel', authenticate, authorize(['csr']), cancelHandler);

export default router;
