import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';

const router = express.Router();

// Notifications
router.get('/notifications', authenticate, async (req: any, res) => {
  const userId = req.user.id;
  try {
    const notifications = await db('notifications')
      .leftJoin('notification_read_receipts', function() {
        this.on('notifications.id', '=', 'notification_read_receipts.notification_id')
            .andOn('notification_read_receipts.user_id', '=', db.raw('?', [userId]));
      })
      .select('notifications.*', 'notification_read_receipts.read_at');
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

router.post('/notifications/read', authenticate, async (req: any, res) => {
  const { notification_id } = req.body;
  const userId = req.user.id;
  try {
    await db('notification_read_receipts').insert({
      notification_id,
      user_id: userId,
      read_at: db.fn.now()
    }).onConflict(['notification_id', 'user_id']).ignore();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Trainings
router.get('/trainings', authenticate, async (req: any, res) => {
  const userId = req.user.id;
  try {
    const trainings = await db('trainings')
      .leftJoin('training_completions', function() {
        this.on('trainings.id', '=', 'training_completions.training_id')
            .andOn('training_completions.user_id', '=', db.raw('?', [userId]));
      })
      .select('trainings.*', 'training_completions.completed_at');
    res.json(trainings);
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

router.post('/trainings/complete', authenticate, async (req: any, res) => {
  const { training_id } = req.body;
  const userId = req.user.id;
  try {
    await db('training_completions').insert({
      training_id,
      user_id: userId,
      completed_at: db.fn.now()
    }).onConflict(['training_id', 'user_id']).ignore();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

export default router;
