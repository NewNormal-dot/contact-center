import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { startOfDay, addDays, isAfter } from 'date-fns';

const router = express.Router();

// Get my bookings
router.get('/my-bookings', authenticate, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const bookings = await db('slot_bookings')
      .join('work_slots', 'slot_bookings.slot_id', '=', 'work_slots.id')
      .where({ 'slot_bookings.user_id': userId })
      .select('slot_bookings.*', 'work_slots.date', 'work_slots.start_time', 'work_slots.end_time', 'work_slots.duration');
    
    // Convert to camelCase for frontend if needed, but let's keep it consistent
    const formattedBookings = bookings.map(b => ({
      ...b,
      startTime: b.start_time,
      endTime: b.end_time,
      createdAt: b.created_at
    }));

    res.json(formattedBookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Get available slots
router.get('/', authenticate, async (req, res) => {
  try {
    const slots = await db('work_slots').orderBy('date', 'asc').orderBy('start_time', 'asc');
    
    // Enrich with current booking counts
    const enrichedSlots = await Promise.all(slots.map(async (slot) => {
      const [{ count }] = await db('slot_bookings')
        .where({ slot_id: slot.id, status: 'confirmed' })
        .count('id as count');
      return { 
        ...slot, 
        current_bookings: Number(count),
        startTime: slot.start_time,
        endTime: slot.end_time,
        bookingDeadline: slot.booking_deadline,
        createdAt: slot.created_at
      };
    }));

    res.json(enrichedSlots);
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Create Slot (Admin/Superadmin)
router.post('/', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
  const { date, startTime, endTime, start_time, end_time, capacity, bookingDeadline, booking_deadline } = req.body;
  const finalStartTime = start_time || startTime;
  const finalEndTime = end_time || endTime;
  const finalDeadline = booking_deadline || bookingDeadline;

  if (!date || !finalStartTime || !finalEndTime || !capacity) {
    return res.status(400).json({ error: 'Мэдээлэл дутуу байна' });
  }

  try {
    // Basic calculation for duration
    const start = new Date(`1970-01-01T${finalStartTime}`);
    const end = new Date(`1970-01-01T${finalEndTime}`);
    let duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    if (duration < 0) duration += 24; // Handle overnight shifts if any

    const id = uuidv4();
    await db('work_slots').insert({
      id,
      date,
      start_time: finalStartTime,
      end_time: finalEndTime,
      duration,
      capacity,
      booking_deadline: finalDeadline
    });

    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Book Slot (CSR only) - Support both /book (body) and /:slotId/book (params)
const bookHandler = async (req: any, res: any) => {
  const slot_id = req.params.slotId || req.body.slot_id || req.body.slotId;
  const userId = req.user.id;

  if (!slot_id) return res.status(400).json({ error: 'Слот ID шаардлагатай' });

  try {
    const slot = await db('work_slots').where({ id: slot_id }).first();
    if (!slot) return res.status(404).json({ error: 'Слот олдсонгүй' });

    // Check deadline
    if (slot.booking_deadline && isAfter(new Date(), new Date(slot.booking_deadline))) {
      return res.status(400).json({ error: 'Захиалга хийх хугацаа дууссан байна' });
    }

    // Check capacity
    const [{ count }] = await db('slot_bookings')
      .where({ slot_id, status: 'confirmed' })
      .count('id as count');

    if (Number(count) >= slot.capacity) {
      return res.status(400).json({ error: 'Орон тоо дүүрсэн байна' });
    }

    // Already booked this specific slot?
    const alreadyBookedThis = await db('slot_bookings')
      .where({ slot_id, user_id: userId, status: 'confirmed' })
      .first();
    if (alreadyBookedThis) {
      return res.status(400).json({ error: 'Та энэ ээлжийг аль хэдийн захиалсан байна' });
    }

    // Check duplicate booking on same day.
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
      status: 'confirmed'
    });

    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
};

router.post('/book', authenticate, authorize(['csr']), bookHandler);
router.post('/:slotId/book', authenticate, authorize(['csr']), bookHandler);

// Cancel Booking - Support both /cancel (body) and /:slotId/cancel (params)
const cancelHandler = async (req: any, res: any) => {
  const slot_id = req.params.slotId || req.body.slot_id || req.body.slotId;
  const booking_id = req.body.booking_id || req.body.bookingId;
  const userId = req.user.id;

  try {
    let booking;
    if (booking_id) {
      booking = await db('slot_bookings').where({ id: booking_id, user_id: userId }).first();
    } else if (slot_id) {
      booking = await db('slot_bookings').where({ slot_id, user_id: userId }).first();
    }

    if (!booking) return res.status(404).json({ error: 'Захиалга олдсонгүй' });

    const slot = await db('work_slots').where({ id: booking.slot_id }).first();
    // Check deadline
    if (slot.booking_deadline && isAfter(new Date(), new Date(slot.booking_deadline))) {
      return res.status(400).json({ error: 'Цуцлах хугацаа дууссан байна. Зөвхөн арилжаа хийх боломжтой.' });
    }

    await db('slot_bookings').where({ id: booking.id }).delete();
    res.json({ message: 'Захиалга цуцлагдлаа' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
};

router.post('/cancel', authenticate, authorize(['csr']), cancelHandler);
router.post('/:slotId/cancel', authenticate, authorize(['csr']), cancelHandler);

export default router;
