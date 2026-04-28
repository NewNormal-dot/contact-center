import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { toSqlDateTime } from '../utils/sqlDate';
import { logAction } from './audit';

const router = express.Router();

function mapNotification(row: any) {
  return {
    ...row,
    imageUrl: row.image_url,
    authorId: row.author_id,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

function mapTraining(row: any) {
  return {
    ...row,
    attachmentUrl: row.attachment_url,
    attachmentName: row.attachment_name,
    authorId: row.author_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

router.get('/notifications', authenticate, async (req: any, res) => {
  const userId = req.user.id;
  try {
    const notifications = await db('notifications')
      .leftJoin('notification_read_receipts', function () {
        this.on('notifications.id', '=', 'notification_read_receipts.notification_id')
          .andOn('notification_read_receipts.user_id', '=', db.raw('?', [userId]));
      })
      .leftJoin('users', 'notifications.author_id', '=', 'users.id')
      .select('notifications.*', 'notification_read_receipts.read_at', 'users.name as author_name')
      .orderBy('notifications.created_at', 'desc');
    res.json(notifications.map(mapNotification));
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Мэдэгдэл татахад алдаа гарлаа' });
  }
});

router.post('/notifications', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { title, content, imageUrl, image_url, deadline } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Гарчиг болон агуулга шаардлагатай' });
  }

  try {
    const id = uuidv4();
    await db('notifications').insert({
      id,
      title,
      content,
      image_url: image_url || imageUrl || null,
      deadline: toSqlDateTime(deadline),
      author_id: req.user.id,
    });
    await logAction(req.user.id, 'CREATE_NOTIFICATION', 'notifications', id, title);
    res.status(201).json({ id });
  } catch (err) {
    console.error('Create notification error:', err);
    res.status(500).json({ error: 'Мэдэгдэл үүсгэхэд алдаа гарлаа' });
  }
});

router.delete('/notifications/:id', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { id } = req.params;
  try {
    await db('notification_read_receipts').where({ notification_id: id }).delete();
    await db('notifications').where({ id }).delete();
    await logAction(req.user.id, 'DELETE_NOTIFICATION', 'notifications', id, 'Notification deleted');
    res.json({ message: 'Мэдэгдэл устгагдлаа' });
  } catch (err) {
    console.error('Delete notification error:', err);
    res.status(500).json({ error: 'Мэдэгдэл устгахад алдаа гарлаа' });
  }
});

router.post('/notifications/read', authenticate, async (req: any, res) => {
  const { notification_id, notificationId } = req.body;
  const finalNotificationId = notification_id || notificationId;
  const userId = req.user.id;

  if (!finalNotificationId) return res.status(400).json({ error: 'notification_id шаардлагатай' });

  try {
    const existing = await db('notification_read_receipts')
      .where({ notification_id: finalNotificationId, user_id: userId })
      .first();

    if (!existing) {
      await db('notification_read_receipts').insert({
        notification_id: finalNotificationId,
        user_id: userId,
        read_at: db.fn.now(),
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ error: 'Мэдэгдэл уншсан болгоход алдаа гарлаа' });
  }
});

router.get('/trainings', authenticate, async (req: any, res) => {
  const userId = req.user.id;
  try {
    const trainings = await db('trainings')
      .leftJoin('training_completions', function () {
        this.on('trainings.id', '=', 'training_completions.training_id')
          .andOn('training_completions.user_id', '=', db.raw('?', [userId]));
      })
      .leftJoin('users', 'trainings.author_id', '=', 'users.id')
      .select('trainings.*', 'training_completions.completed_at', 'users.name as author_name')
      .orderBy('trainings.created_at', 'desc');
    res.json(trainings.map(mapTraining));
  } catch (err) {
    console.error('Get trainings error:', err);
    res.status(500).json({ error: 'Сургалт татахад алдаа гарлаа' });
  }
});

router.post('/trainings', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { title, description, attachmentUrl, attachment_url, attachmentName, attachment_name, deadline } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: 'Гарчиг болон тайлбар шаардлагатай' });
  }

  try {
    const id = uuidv4();
    await db('trainings').insert({
      id,
      title,
      description,
      attachment_url: attachment_url || attachmentUrl || null,
      attachment_name: attachment_name || attachmentName || null,
      deadline: toSqlDateTime(deadline),
      author_id: req.user.id,
    });
    await logAction(req.user.id, 'CREATE_TRAINING', 'trainings', id, title);
    res.status(201).json({ id });
  } catch (err) {
    console.error('Create training error:', err);
    res.status(500).json({ error: 'Сургалт үүсгэхэд алдаа гарлаа' });
  }
});

router.delete('/trainings/:id', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { id } = req.params;
  try {
    await db('training_completions').where({ training_id: id }).delete();
    await db('trainings').where({ id }).delete();
    await logAction(req.user.id, 'DELETE_TRAINING', 'trainings', id, 'Training deleted');
    res.json({ message: 'Сургалт устгагдлаа' });
  } catch (err) {
    console.error('Delete training error:', err);
    res.status(500).json({ error: 'Сургалт устгахад алдаа гарлаа' });
  }
});

router.post('/trainings/complete', authenticate, async (req: any, res) => {
  const { training_id, trainingId } = req.body;
  const finalTrainingId = training_id || trainingId;
  const userId = req.user.id;

  if (!finalTrainingId) return res.status(400).json({ error: 'training_id шаардлагатай' });

  try {
    const existing = await db('training_completions')
      .where({ training_id: finalTrainingId, user_id: userId })
      .first();

    if (!existing) {
      await db('training_completions').insert({
        training_id: finalTrainingId,
        user_id: userId,
        completed_at: db.fn.now(),
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Complete training error:', err);
    res.status(500).json({ error: 'Сургалт дуусгахад алдаа гарлаа' });
  }
});

export default router;
