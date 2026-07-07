import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { toSqlDate, toSqlDateTime, toSqlTime, displayDate, displayTime } from '../utils/sqlDate';

const router = express.Router();

function displayDateTime(value: unknown) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeEmploymentType(value: unknown) {
  return String(value || 'Full Time').trim() === 'Part Time' ? 'Part Time' : 'Full Time';
}

function normalizeSegment(value: unknown) {
  return String(value || 'All').trim() || 'All';
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

function boolValue(value: unknown) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function resolveBookingWindow(day: any, shift: any) {
  const waves = Array.isArray(shift?.bookingWaves) ? shift.bookingWaves : [];
  const openWaves = waves.filter((wave: any) => boolValue(wave.bookingOpen));
  const bookingOpen = day?.bookingOpen === undefined
    ? openWaves.length > 0
    : boolValue(day.bookingOpen) || openWaves.length > 0;
  const openAt = openWaves.find((wave: any) => wave.bookingOpenAt)?.bookingOpenAt
    || shift.bookingOpenAt
    || day?.bookingOpenAt
    || null;
  const closeAt = openWaves.find((wave: any) => wave.bookingCloseAt)?.bookingCloseAt
    || shift.bookingCloseAt
    || day?.bookingCloseAt
    || day?.bookingDeadline
    || shift.bookingDeadline
    || null;

  return {
    bookingOpen,
    bookingOpenAt: bookingOpen ? toSqlDateTime(openAt) : null,
    bookingDeadline: bookingOpen
      ? toSqlDateTime(closeAt, new Date(Date.now() + 24 * 60 * 60 * 1000))
      : new Date(0),
  };
}

function slotIdentity(slot: any) {
  return [
    displayDate(slot.date),
    displayTime(slot.start_time),
    displayTime(slot.end_time),
    normalizeSegment(slot.segment),
    normalizeEmploymentType(slot.employment_type),
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
    duration: Number(slot.duration || 0),
    capacity: Number(slot.capacity || 0),
    bookingOpen: boolValue(slot.booking_is_open),
    bookingOpenAt: displayDateTime(slot.booking_open_at),
    bookingDeadline: displayDateTime(slot.booking_deadline),
    segment: normalizeSegment(slot.segment),
    employmentType: normalizeEmploymentType(slot.employment_type),
    isRest,
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
    duration: Number(row.duration || 0),
    capacity: Number(row.capacity || 0),
    bookingOpen: boolValue(row.booking_is_open),
    bookingOpenAt: displayDateTime(row.booking_open_at),
    bookingDeadline: displayDateTime(row.booking_deadline),
    segment: normalizeSegment(row.segment),
    employmentType: normalizeEmploymentType(row.employment_type),
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
  const segment = normalizeSegment(user.segment || user.lineType);
  const employmentType = normalizeEmploymentType(user.employment_type || user.employmentType);
  const row = await db('shift_rule_settings')
    .where({ rule_type: 'weekly_shift_rules', segment, employment_type: employmentType })
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
  const duration = Math.round(Number(slot.duration || 0));
  return duration >= 4 && duration <= 9 ? String(duration) : '';
}

async function validateUserWeeklyLimit(userId: string, targetSlot: any, excludeSlotId?: string) {
  const user = await getUser(userId);
  if (!user) return 'Хэрэглэгч олдсонгүй';
  const rule = await getRuleForUser(user);
  if (!rule) return '';

  const selectedDaysLimit = Number(rule.selectedDays || 0);
  const hourCounts = rule.hourCounts || {};
  const targetDate = displayDate(targetSlot.date);
  const weekStart = getWeekStart(targetDate);
  const weekEnd = addDays(weekStart, 7);

  const rows = await db('slot_bookings')
    .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
    .where({ 'slot_bookings.user_id': userId, 'slot_bookings.status': 'confirmed' })
    .where('work_slots.date', '>=', weekStart)
    .where('work_slots.date', '<', weekEnd)
    .select('slot_bookings.slot_id', 'work_slots.duration', 'work_slots.is_rest');

  const filtered = rows.filter((row: any) => row.slot_id !== excludeSlotId);
  if (selectedDaysLimit > 0 && filtered.length + 1 > selectedDaysLimit) {
    return `Та аль хэдийн ${selectedDaysLimit} өдрийн хуваарь сонгосон байна.`;
  }

  const targetHourKey = hourKeyForSlot(targetSlot);
  if (targetHourKey) {
    const maxForHour = Number(hourCounts[targetHourKey] || 0);
    const currentForHour = filtered.filter((row: any) => hourKeyForSlot(row) === targetHourKey).length;
    if (maxForHour === 0 && Object.keys(hourCounts).length > 0) {
      return targetHourKey === 'rest' ? 'Амралтын өдөр сонгох боломжгүй.' : `${targetHourKey} цагтай хуваарь сонгох боломжгүй.`;
    }
    if (maxForHour > 0 && currentForHour + 1 > maxForHour) {
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
      .join('users', 'slot_bookings.user_id', '=', 'users.id')
      .where('slot_bookings.status', 'confirmed')
      .select(
        'slot_bookings.*',
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
        'work_slots.is_rest',
        'users.name as user_name',
        'users.email as user_email',
        'users.code as user_code',
      );

    if (req.user.role === 'csr') query = query.where('slot_bookings.user_id', req.user.id);

    const bookings = await query.orderBy('work_slots.date', 'asc').orderBy('work_slots.start_time', 'asc');
    res.json(bookings.map(mapBooking));
  } catch (err) {
    console.error('Get bookings error:', err);
    res.status(500).json({ error: 'Захиалгууд татахад алдаа гарлаа' });
  }
});

router.get('/my-bookings', authenticate, async (req: any, res) => {
  try {
    const bookings = await db('slot_bookings')
      .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
      .where({ 'slot_bookings.user_id': req.user.id, 'slot_bookings.status': 'confirmed' })
      .select('slot_bookings.*', 'work_slots.*')
      .orderBy('work_slots.date', 'asc')
      .orderBy('work_slots.start_time', 'asc');
    res.json(bookings.map(mapBooking));
  } catch (err) {
    console.error('Get my bookings error:', err);
    res.status(500).json({ error: 'Миний захиалга татахад алдаа гарлаа' });
  }
});

router.get('/', authenticate, async (_req, res) => {
  try {
    const slots = await db('work_slots').orderBy('date', 'asc').orderBy('start_time', 'asc');
    const enrichedSlots = await Promise.all(slots.map(async (slot: any) => {
      const bookings = await db('slot_bookings')
        .join('users', 'slot_bookings.user_id', '=', 'users.id')
        .where({ 'slot_bookings.slot_id': slot.id, 'slot_bookings.status': 'confirmed' })
        .select(
          'slot_bookings.id',
          'slot_bookings.user_id',
          'slot_bookings.booked_at',
          'users.name as user_name',
          'users.email as user_email',
          'users.code as user_code',
          'users.segment as user_segment',
          'users.employment_type as user_employment_type',
        );
      return mapSlot(slot, bookings.length, bookings.map((b: any) => ({
        id: b.id,
        userId: b.user_id,
        userName: b.user_name,
        userEmail: b.user_email,
        userCode: b.user_code,
        bookedAt: b.booked_at,
        segment: b.user_segment,
        employmentType: b.user_employment_type,
      })));
    }));
    res.json(enrichedSlots);
  } catch (err) {
    console.error('Get slots error:', err);
    res.status(500).json({ error: 'Слотууд татахад алдаа гарлаа' });
  }
});

router.post('/', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { date, startTime, endTime, start_time, end_time, capacity, bookingDeadline, booking_deadline, bookingOpen, booking_open, bookingOpenAt, booking_open_at, segment, employmentType, employment_type, isRest, is_rest } = req.body;
  const finalCapacity = Math.max(1, Number(capacity) || 1);
  const rest = Boolean(isRest || is_rest || startTime === 'Амралт' || start_time === 'Амралт');
  const sqlSlotDate = toSqlDate(date);
  const sqlStartTime = rest ? '00:00:00' : normalizeTime(start_time || startTime);
  const sqlEndTime = rest ? '00:00:00' : normalizeTime(end_time || endTime);
  const sqlDeadline = toSqlDateTime(booking_deadline || bookingDeadline, new Date(Date.now() + 24 * 60 * 60 * 1000));
  const sqlOpenAt = toSqlDateTime(booking_open_at || bookingOpenAt);
  const finalBookingOpen = boolValue(booking_open ?? bookingOpen);
  const finalSegment = normalizeSegment(segment);
  const finalEmploymentType = normalizeEmploymentType(employment_type || employmentType);

  if (!sqlSlotDate || !sqlDeadline || (!rest && (!sqlStartTime || !sqlEndTime))) {
    return res.status(400).json({ error: 'Огноо болон цагийн формат буруу байна' });
  }

  try {
    const duplicateSlot = await db('work_slots')
      .where({ date: sqlSlotDate, start_time: sqlStartTime, end_time: sqlEndTime, segment: finalSegment, employment_type: finalEmploymentType, is_rest: rest ? 1 : 0 })
      .first();

    const duration = rest ? 0 : calculateDuration(sqlStartTime, sqlEndTime, req.body.duration);
    if (duplicateSlot) {
      await db('work_slots').where({ id: duplicateSlot.id }).update({ capacity: finalCapacity, booking_open_at: sqlOpenAt, booking_is_open: finalBookingOpen ? 1 : 0, booking_deadline: finalBookingOpen ? sqlDeadline : new Date(0), updated_at: db.fn.now() });
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
      booking_deadline: finalBookingOpen ? sqlDeadline : new Date(0),
      segment: finalSegment,
      employment_type: finalEmploymentType,
      is_rest: rest ? 1 : 0,
    });
    res.status(201).json({ id });
  } catch (err) {
    console.error('Create slot error:', err);
    res.status(500).json({ error: 'Слот үүсгэхэд алдаа гарлаа' });
  }
});

router.post('/sync-schedules', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { schedules, dateKeys } = req.body;
  if (!schedules || typeof schedules !== 'object') return res.status(400).json({ error: 'schedules шаардлагатай' });
  const keys = Array.isArray(dateKeys) && dateKeys.length ? dateKeys : Object.keys(schedules);
  let synced = 0;
  let deleted = 0;
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
              continue;
            }
          }

          const segment = normalizeSegment(shift.segment);
          const employmentType = normalizeEmploymentType(shift.employmentType || shift.employment_type);
          const sqlStart = rest ? '00:00:00' : normalizeTime(startTime);
          const sqlEnd = rest ? '00:00:00' : normalizeTime(endTime);
          if (!rest && (!sqlStart || !sqlEnd)) {
            console.warn('Skipping work slot with invalid normalized time during sync:', { dateKey, startTime, endTime, shift });
            continue;
          }
          const bookingWindow = resolveBookingWindow(day, shift);
          incomingSlots.push({
            id: shift.id || uuidv4(),
            date: dateKey,
            start_time: sqlStart,
            end_time: sqlEnd,
            duration: rest ? 0 : calculateDuration(sqlStart, sqlEnd),
            capacity: Math.max(1, Number(shift.totalSlots || shift.capacity || 1) || 1),
            booking_open_at: bookingWindow.bookingOpenAt,
            booking_is_open: bookingWindow.bookingOpen ? 1 : 0,
            booking_deadline: bookingWindow.bookingDeadline,
            segment,
            employment_type: employmentType,
            is_rest: rest ? 1 : 0,
            updated_at: trx.fn.now(),
          });
        }

        const existingRows = await trx('work_slots').where({ date: dateKey }).select('*');
        const existingById = new Map(existingRows.map((row: any) => [String(row.id), row]));
        const existingByIdentity = new Map(existingRows.map((row: any) => [slotIdentity(row), row]));
        const keptIds = new Set<string>();

        for (const payload of incomingSlots) {
          const existing = existingById.get(String(payload.id)) || existingByIdentity.get(slotIdentity(payload));
          if (existing) {
            await trx('work_slots').where({ id: existing.id }).update(payload);
            keptIds.add(String(existing.id));
          } else {
            await trx('work_slots').insert({ ...payload, created_at: trx.fn.now() });
            keptIds.add(String(payload.id));
          }
          synced += 1;
        }

        const staleRows = existingRows.filter((row: any) => !keptIds.has(String(row.id)));
        if (staleRows.length > 0) {
          const staleIds = staleRows.map((row: any) => row.id);
          await trx('slot_bookings').whereIn('slot_id', staleIds).delete();
          await trx('work_slots').whereIn('id', staleIds).delete();
          deleted += staleRows.length;
        }
      }
    });
    res.json({ synced, deleted });
  } catch (err) {
    console.error('Sync schedules error:', err);
    res.status(500).json({ error: 'Хуваарь DB-д хадгалахад алдаа гарлаа' });
  }
});

router.delete('/:id', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
  try {
    await db('slot_bookings').where({ slot_id: req.params.id }).delete();
    await db('work_slots').where({ id: req.params.id }).delete();
    res.json({ message: 'Слот устгагдлаа' });
  } catch (err) {
    console.error('Delete slot error:', err);
    res.status(500).json({ error: 'Слот устгахад алдаа гарлаа' });
  }
});

router.delete('/:slotId/bookings/:userId', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
  const { slotId, userId } = req.params;
  try {
    const deleted = await db('slot_bookings')
      .where({ slot_id: slotId, user_id: userId, status: 'confirmed' })
      .delete();

    if (!deleted) {
      return res.status(404).json({ error: 'Захиалга олдсонгүй' });
    }

    res.json({ message: 'Захиалга хасагдлаа' });
  } catch (err) {
    console.error('Remove booking error:', err);
    res.status(500).json({ error: 'Захиалга хасахад алдаа гарлаа' });
  }
});

const bookHandler = async (req: any, res: any) => {
  const slot_id = req.params.slotId || req.body.slot_id || req.body.slotId;
  const userId = req.user.id;
  const editBookingId = req.body.editBookingId || req.body.booking_id || req.body.bookingId;
  if (!slot_id) return res.status(400).json({ error: 'Слот ID шаардлагатай' });

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

    const user = await getUser(userId);
    if (!user) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    if (normalizeSegment(slot.segment) !== 'All' && normalizeSegment(slot.segment) !== normalizeSegment(user.segment)) {
      return res.status(403).json({ error: 'Өөр segment-ийн хуваарь сонгох боломжгүй' });
    }
    if (normalizeEmploymentType(slot.employment_type) !== normalizeEmploymentType(user.employment_type)) {
      return res.status(403).json({ error: 'Full/Part төрөл таарахгүй байна' });
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
    if (ruleError) return res.status(400).json({ error: ruleError });

    const bookingResult = await db.transaction(async trx => {
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

      if (currentBooking) {
        await trx('slot_bookings').where({ id: currentBooking.id }).update({ slot_id, booked_at: db.fn.now(), status: 'confirmed' });
        return { id: currentBooking.id, edited: true };
      }

      const id = uuidv4();
      await trx('slot_bookings').insert({ id, slot_id, user_id: userId, status: 'confirmed' });
      return { id, created: true };
    });

    if ('error' in bookingResult) {
      return res.status(bookingResult.status).json({ error: bookingResult.error });
    }

    if ('edited' in bookingResult && bookingResult.edited) {
      return res.json({ id: bookingResult.id, edited: true });
    }

    res.status(201).json({ id: bookingResult.id });
  } catch (err) {
    console.error('Book slot error:', err);
    res.status(500).json({ error: 'Захиалга хийхэд алдаа гарлаа' });
  }
};

router.post('/book', authenticate, authorize(['csr']), bookHandler);
router.post('/:slotId/book', authenticate, authorize(['csr']), bookHandler);
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
    res.json({ message: 'Захиалга цуцлагдлаа' });
  } catch (err) {
    console.error('Cancel booking error:', err);
    res.status(500).json({ error: 'Цуцлахад алдаа гарлаа' });
  }
};

router.post('/cancel', authenticate, authorize(['csr']), cancelHandler);
router.post('/:slotId/cancel', authenticate, authorize(['csr']), cancelHandler);

export default router;
