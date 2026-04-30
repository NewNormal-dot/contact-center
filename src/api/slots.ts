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

function mapSlot(slot: any, currentBookings = 0) {
  return {
    ...slot,
    date: displayDate(slot.date),
    startTime: displayTime(slot.start_time),
    endTime: displayTime(slot.end_time),
    bookingDeadline: displayDateTime(slot.booking_deadline),
    createdAt: slot.created_at,
    updatedAt: slot.updated_at,
    current_bookings: currentBookings,
    currentBookings,
  };
}

function mapBooking(row: any) {
  return {
    ...row,
    slotId: row.slot_id,
    userId: row.user_id,
    bookedAt: row.booked_at,
    date: displayDate(row.date),
    startTime: displayTime(row.start_time),
    endTime: displayTime(row.end_time),
    bookingDeadline: displayDateTime(row.booking_deadline),
    userName: row.user_name,
    userEmail: row.user_email,
  };
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
        'work_slots.booking_deadline',
        'users.name as user_name',
        'users.email as user_email',
      );

    if (req.user.role === 'csr') {
      query = query.where('slot_bookings.user_id', req.user.id);
    }

    const bookings = await query.orderBy('work_slots.date', 'asc').orderBy('work_slots.start_time', 'asc');
    res.json(bookings.map(mapBooking));
  } catch (err) {
    console.error('Get bookings error:', err);
    res.status(500).json({ error: 'Захиалгууд татахад алдаа гарлаа' });
  }
});

// Get my bookings
router.get('/my-bookings', authenticate, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const bookings = await db('slot_bookings')
      .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
      .where({ 'slot_bookings.user_id': userId, 'slot_bookings.status': 'confirmed' })
      .select(
        'slot_bookings.*',
        'work_slots.date',
        'work_slots.start_time',
        'work_slots.end_time',
        'work_slots.duration',
        'work_slots.capacity',
        'work_slots.booking_deadline',
      )
      .orderBy('work_slots.date', 'asc')
      .orderBy('work_slots.start_time', 'asc');

    res.json(bookings.map(mapBooking));
  } catch (err) {
    console.error('Get my bookings error:', err);
    res.status(500).json({ error: 'Миний захиалга татахад алдаа гарлаа' });
  }
});

// Get available slots
router.get('/', authenticate, async (req, res) => {
  try {
    const slots = await db('work_slots').orderBy('date', 'asc').orderBy('start_time', 'asc');

    const enrichedSlots = await Promise.all(
      slots.map(async (slot) => {
        const [{ count }] = await db('slot_bookings')
          .where({ slot_id: slot.id, status: 'confirmed' })
          .count('id as count');
        return mapSlot(slot, Number(count));
      }),
    );

    res.json(enrichedSlots);
  } catch (err) {
    console.error('Get slots error:', err);
    res.status(500).json({ error: 'Слотууд татахад алдаа гарлаа' });
  }
});

// Create Slot (Admin/Superadmin)
router.post('/', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
  const { date, startTime, endTime, start_time, end_time, capacity, bookingDeadline, booking_deadline } = req.body;
  const finalStartTime = start_time || startTime;
  const finalEndTime = end_time || endTime;
  const finalDeadline = booking_deadline || bookingDeadline || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const finalCapacity = Number(capacity);

  if (!date || !finalStartTime || !finalEndTime || !Number.isFinite(finalCapacity) || finalCapacity < 1) {
    return res.status(400).json({ error: 'Огноо, эхлэх/дуусах цаг, багтаамжийг зөв оруулна уу' });
  }

  try {
    const sqlSlotDate = toSqlDate(date);
    const sqlStartTime = toSqlTime(finalStartTime);
    const sqlEndTime = toSqlTime(finalEndTime);
    const sqlDeadline = toSqlDateTime(finalDeadline, new Date(Date.now() + 24 * 60 * 60 * 1000));

    if (!sqlSlotDate || !sqlStartTime || !sqlEndTime || !sqlDeadline) {
      return res.status(400).json({ error: 'Огноо болон цагийн формат буруу байна' });
    }

    const start = new Date(`1970-01-01T${sqlStartTime}`);
    const end = new Date(`1970-01-01T${sqlEndTime}`);
    let duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    if (duration <= 0) duration += 24;

    const id = uuidv4();
    await db('work_slots').insert({
      id,
      date: sqlSlotDate,
      start_time: sqlStartTime,
      end_time: sqlEndTime,
      duration,
      capacity: finalCapacity,
      booking_deadline: sqlDeadline,
    });

    res.status(201).json({ id });
  } catch (err) {
    console.error('Create slot error:', err);
    res.status(500).json({ error: 'Слот үүсгэхэд алдаа гарлаа' });
  }
});

router.delete('/:id', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
  const { id } = req.params;
  try {
    await db('slot_bookings').where({ slot_id: id }).delete();
    await db('work_slots').where({ id }).delete();
    res.json({ message: 'Слот устгагдлаа' });
  } catch (err) {
    console.error('Delete slot error:', err);
    res.status(500).json({ error: 'Слот устгахад алдаа гарлаа' });
  }
});

const bookHandler = async (req: any, res: any) => {
  const slot_id = req.params.slotId || req.body.slot_id || req.body.slotId;
  const userId = req.user.id;

  if (!slot_id) return res.status(400).json({ error: 'Слот ID шаардлагатай' });

  try {
    const slot = await db('work_slots').where({ id: slot_id }).first();
    if (!slot) return res.status(404).json({ error: 'Слот олдсонгүй' });

    if (slot.booking_deadline && new Date().getTime() > new Date(slot.booking_deadline).getTime()) {
      return res.status(400).json({ error: 'Захиалга хийх хугацаа дууссан байна' });
    }

    const [{ count }] = await db('slot_bookings')
      .where({ slot_id, status: 'confirmed' })
      .count('id as count');

    if (Number(count) >= Number(slot.capacity)) {
      return res.status(400).json({ error: 'Орон тоо дүүрсэн байна' });
    }

    const alreadyBookedThis = await db('slot_bookings')
      .where({ slot_id, user_id: userId, status: 'confirmed' })
      .first();
    if (alreadyBookedThis) {
      return res.status(400).json({ error: 'Та энэ ээлжийг аль хэдийн захиалсан байна' });
    }

    const existingOnSameDay = await db('slot_bookings')
      .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
      .where({ 'slot_bookings.user_id': userId, 'work_slots.date': slot.date, 'slot_bookings.status': 'confirmed' })
      .first();

    if (existingOnSameDay) {
      return res.status(400).json({ error: 'Энэ өдөр аль хэдийн захиалга хийсэн байна' });
    }

    const id = uuidv4();
    await db('slot_bookings').insert({
      id,
      slot_id,
      user_id: userId,
      status: 'confirmed',
    });

    res.status(201).json({ id });
  } catch (err) {
    console.error('Book slot error:', err);
    res.status(500).json({ error: 'Захиалга хийхэд алдаа гарлаа' });
  }
};

router.post('/book', authenticate, authorize(['csr']), bookHandler);
router.post('/:slotId/book', authenticate, authorize(['csr']), bookHandler);

const cancelHandler = async (req: any, res: any) => {
  const slot_id = req.params.slotId || req.body.slot_id || req.body.slotId;
  const booking_id = req.body.booking_id || req.body.bookingId;
  const userId = req.user.id;

  try {
    let booking;
    if (booking_id) {
      booking = await db('slot_bookings').where({ id: booking_id, user_id: userId }).first();
    } else if (slot_id) {
      booking = await db('slot_bookings').where({ slot_id, user_id: userId, status: 'confirmed' }).first();
    }

    if (!booking) return res.status(404).json({ error: 'Захиалга олдсонгүй' });

    const slot = await db('work_slots').where({ id: booking.slot_id }).first();
    if (slot?.booking_deadline && new Date().getTime() > new Date(slot.booking_deadline).getTime()) {
      return res.status(400).json({ error: 'Цуцлах хугацаа дууссан байна. Зөвхөн арилжаа хийх боломжтой.' });
    }

    await db('slot_bookings').where({ id: booking.id }).delete();
    res.json({ message: 'Захиалга цуцлагдлаа' });
  } catch (err) {
    console.error('Cancel booking error:', err);
    res.status(500).json({ error: 'Цуцлахад алдаа гарлаа' });
  }
};

router.post('/cancel', authenticate, authorize(['csr']), cancelHandler);
router.post('/:slotId/cancel', authenticate, authorize(['csr']), cancelHandler);

export default router;
