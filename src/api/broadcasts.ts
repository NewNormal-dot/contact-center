import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { toSqlDateTime } from '../utils/sqlDate';
import { logAction } from './audit';
import { isDuplicateKeyError } from '../utils/dbErrors';
import { captureError } from '../utils/errorLog';
import { createThrottledTask } from '../utils/throttledTask';
import { tableExists } from '../database/schemaUtils';

const router = express.Router();

function mapNotification(row: any) {
  return {
    ...row,
    imageUrl: row.image_url,
    authorId: row.author_id,
    targetUserId: row.target_user_id,
    targetUserName: row.target_user_name,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readAt: row.read_at,
  };
}

// trainings.attachment_url is nvarchar(255); anything bigger (a base64 file
// from the upload control) lives in training_attachments and is fetched on
// demand. See migrations/20260918000000_create_training_attachments.
const INLINE_ATTACHMENT_MAX = 255;
const STORED_ATTACHMENT_MAX_CHARS = 5 * 1024 * 1024; // ~5MB of base64

async function hasAttachmentTable() {
  return tableExists(db, 'training_attachments');
}

/**
 * True for a duplicate-key / unique-constraint violation on any of the three
 * dialects this app talks to. Both of the tables below have a composite
 * primary key and were written with a check-then-insert, so an ordinary
 * double-click or two open tabs raced and surfaced the violation as a bare
 * 500. The row already existing is the desired end state, so swallow it.
 */
function textField(value: unknown, max: number) {
  const text = String(value ?? '').trim();
  return text.length > max ? null : text;
}

function mapTraining(row: any) {
  return {
    ...row,
    attachmentUrl: row.attachment_url,
    attachmentName: row.attachment_name,
    authorId: row.author_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    // True when the payload lives in training_attachments and has to be
    // fetched through GET /trainings/:id/attachment.
    hasStoredAttachment: Boolean(row.has_stored_attachment),
  };
}

function threeMonthsAgo() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
}

// Notifications older than 3 months (from today, not from when they were
// created - so the visible window rolls forward one day at a time) are
// purged. Runs opportunistically on fetch instead of via a cron job, but
// THROTTLED: this is a DELETE across the whole table and it used to run on
// literally every notification fetch, from every open dashboard. The window
// it prunes only moves once a day, so once an hour is ample.
const PURGE_MIN_INTERVAL_MS = 60 * 60 * 1000;

const purgeOldNotifications = createThrottledTask(
  async () => {
    const deleted = await db('notifications').where('created_at', '<', threeMonthsAgo()).del();
    if (deleted) console.log(`Purged ${deleted} notification(s) older than 3 months`);
  },
  PURGE_MIN_INTERVAL_MS,
  'purgeOldNotifications',
);

router.get('/notifications', authenticate, async (req: any, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  try {
    await purgeOldNotifications();
    if (userRole === 'admin' || userRole === 'superadmin') {
      // For admin/superadmin, get all notifications with read receipts from all users
      const notifications = await db('notifications')
        .leftJoin('users', 'notifications.author_id', '=', 'users.id')
        .leftJoin('users as target_users', 'notifications.target_user_id', '=', 'target_users.id')
        .where(function () {
          // Only broadcast notifications (everyone) or ones addressed to
          // THIS admin specifically - not other users' personal
          // notifications (a CSR's trade offer, another admin's own copy
          // of a leave-request alert, etc.), which aren't this admin's
          // concern and only cluttered the page.
          this.whereNull('notifications.target_user_id')
            .orWhere('notifications.target_user_id', userId);
        })
        .select(
          'notifications.id',
          'notifications.title',
          'notifications.content',
          'notifications.image_url',
          'notifications.deadline',
          'notifications.type',
          'notifications.target_user_id',
          'notifications.related_entity_type',
          'notifications.related_entity_id',
          'notifications.created_at',
          'notifications.updated_at',
          'notifications.author_id',
          'users.name as author_name',
          'target_users.name as target_user_name'
        )
        .orderBy('notifications.created_at', 'desc');

      // Read receipts used to be fetched with one query PER notification
      // (an N+1): an admin holding 150 notifications on screen produced 150
      // extra round-trips to Azure SQL on every single poll. They are now
      // fetched for all of them at once and grouped in memory, turning that
      // into exactly one additional query regardless of how many
      // notifications there are.
      const notificationIds = notifications.map((n: any) => n.id);
      const allReceipts = notificationIds.length
        ? await db('notification_read_receipts')
            .leftJoin('users', 'notification_read_receipts.user_id', '=', 'users.id')
            .whereIn('notification_read_receipts.notification_id', notificationIds)
            .select(
              'notification_read_receipts.notification_id',
              'notification_read_receipts.user_id',
              'notification_read_receipts.read_at',
              'users.name as user_name',
            )
        : [];

      const receiptsByNotificationId = new Map<string, any[]>();
      for (const receipt of allReceipts as any[]) {
        const key = String(receipt.notification_id);
        if (!receiptsByNotificationId.has(key)) receiptsByNotificationId.set(key, []);
        receiptsByNotificationId.get(key)!.push({
          user_id: receipt.user_id,
          read_at: receipt.read_at,
          user_name: receipt.user_name,
        });
      }

      const result = notifications.map((notif: any) => ({
        ...mapNotification(notif),
        notification_read_receipts: receiptsByNotificationId.get(String(notif.id)) || [],
      }));

      res.json(result);
    } else {
      // For CSR, only get own read status
      const notifications = await db('notifications')
        .where(function () {
          this.whereNull('notifications.target_user_id')
            .orWhere('notifications.target_user_id', userId);
        })
        .leftJoin('notification_read_receipts', function () {
          this.on('notifications.id', '=', 'notification_read_receipts.notification_id')
            .andOn('notification_read_receipts.user_id', '=', db.raw('?', [userId]));
        })
        .leftJoin('users', 'notifications.author_id', '=', 'users.id')
        .select('notifications.*', 'notification_read_receipts.read_at', 'users.name as author_name')
        .orderBy('notifications.created_at', 'desc');
      res.json(notifications.map(mapNotification));
    }
  } catch (err) {
    console.error('Get notifications error:', err);
    captureError('broadcasts: Get notifications error:', err);
    res.status(500).json({ error: 'Мэдэгдэл татахад алдаа гарлаа' });
  }
});

router.post('/notifications', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const {
    title,
    content,
    imageUrl,
    image_url,
    deadline,
    type,
    targetUserId,
    target_user_id,
    relatedEntityType,
    related_entity_type,
    relatedEntityId,
    related_entity_id,
  } = req.body;

  const finalTitle = textField(title, 200);
  const finalImageUrl = textField(image_url ?? imageUrl, 2000);

  if (!title || !content) {
    return res.status(400).json({ error: 'Гарчиг болон агуулга шаардлагатай' });
  }
  // notifications.title and image_url are nvarchar(255); an oversized value
  // used to reach SQL Server and come back as a truncation 500.
  if (finalTitle === null) return res.status(400).json({ error: 'Гарчиг хэт урт байна (200 тэмдэгт)' });
  if (String(content).length > 5000) return res.status(400).json({ error: 'Агуулга хэт урт байна (5000 тэмдэгт)' });
  if (finalImageUrl === null || (finalImageUrl && finalImageUrl.length > 255)) {
    return res.status(400).json({ error: 'Зургийн холбоос хэт урт байна. Файл хавсаргах бус холбоос ашиглана уу.' });
  }

  try {
    const id = uuidv4();
    await db('notifications').insert({
      id,
      title: finalTitle,
      content,
      image_url: finalImageUrl || null,
      deadline: toSqlDateTime(deadline),
      type: type || 'general',
      target_user_id: target_user_id || targetUserId || null,
      related_entity_type: related_entity_type || relatedEntityType || null,
      related_entity_id: related_entity_id || relatedEntityId || null,
      author_id: req.user.id,
    });
    await logAction(req.user.id, 'CREATE_NOTIFICATION', 'notifications', id, title, req);
    res.status(201).json({ id });
  } catch (err) {
    console.error('Create notification error:', err);
    captureError('broadcasts: Create notification error:', err);
    res.status(500).json({ error: 'Мэдэгдэл үүсгэхэд алдаа гарлаа' });
  }
});

router.delete('/notifications/:id', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { id } = req.params;
  try {
    const existing = await db('notifications').where({ id }).first();
    // Used to return 200 for an id that did not exist, so the UI reported a
    // successful delete for a no-op.
    if (!existing) return res.status(404).json({ error: 'Мэдэгдэл олдсонгүй' });

    // Any admin could delete ANY notification, including other admins' and
    // system-generated ones. Authors may remove their own; superadmins may
    // remove anything.
    if (req.user.role !== 'superadmin' && existing.author_id && String(existing.author_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Зөвхөн өөрийн үүсгэсэн мэдэгдлийг устгах боломжтой' });
    }

    await db('notification_read_receipts').where({ notification_id: id }).delete();
    await db('notifications').where({ id }).delete();
    await logAction(req.user.id, 'DELETE_NOTIFICATION', 'notifications', id, `Notification deleted: ${existing.title}`, req);
    res.json({ message: 'Мэдэгдэл устгагдлаа' });
  } catch (err) {
    console.error('Delete notification error:', err);
    captureError('broadcasts: Delete notification error:', err);
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
      try {
        await db('notification_read_receipts').insert({
          notification_id: finalNotificationId,
          user_id: userId,
          read_at: db.fn.now(),
        });
      } catch (insertErr) {
        // Lost the race with another tab/click - the receipt now exists,
        // which is exactly what the caller asked for.
        if (!isDuplicateKeyError(insertErr)) throw insertErr;
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Mark notification read error:', err);
    captureError('broadcasts: Mark notification read error:', err);
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

    // Flag which materials carry a stored payload WITHOUT sending it - every
    // dashboard polls this list, and a base64 file per row would make it
    // enormous. The body is fetched from /trainings/:id/attachment when a
    // material is actually opened.
    let storedIds = new Set<string>();
    if (trainings.length > 0 && (await hasAttachmentTable())) {
      const rows = await db('training_attachments')
        .whereIn('training_id', trainings.map((t: any) => t.id))
        .select('training_id');
      storedIds = new Set(rows.map((r: any) => String(r.training_id)));
    }

    res.json(trainings.map((row: any) => mapTraining({
      ...row,
      has_stored_attachment: storedIds.has(String(row.id)),
    })));
  } catch (err) {
    console.error('Get trainings error:', err);
    captureError('broadcasts: Get trainings error:', err);
    res.status(500).json({ error: 'Сургалт татахад алдаа гарлаа' });
  }
});

async function saveTrainingAttachment(trainingId: string, rawUrl: string, name: string | null) {
  if (!rawUrl || rawUrl.length <= INLINE_ATTACHMENT_MAX) return { inline: rawUrl || null };

  if (rawUrl.length > STORED_ATTACHMENT_MAX_CHARS) {
    return { error: 'Хавсралт хэт том байна (дээд тал нь ~3.5MB файл).' };
  }
  if (!(await hasAttachmentTable())) {
    return {
      error:
        'Файл хавсаргах боломж идэвхжээгүй байна (training_attachments migration хийгдээгүй). ' +
        'Одоохондоо холбоос (URL) ашиглана уу.',
    };
  }

  const contentType = rawUrl.startsWith('data:')
    ? rawUrl.slice(5, Math.max(5, rawUrl.indexOf(';'))) || null
    : null;

  // NOT onConflict(): knex does not implement it for the mssql dialect, so
  // it would throw on Azure SQL while working fine on the sqlite used in
  // local development. Delete-then-insert is dialect-neutral, and this is a
  // single-admin write path where the race is not meaningful.
  await db('training_attachments').where({ training_id: trainingId }).delete();
  await db('training_attachments').insert({
    training_id: trainingId,
    data: rawUrl,
    name,
    content_type: contentType,
  });

  return { inline: null, stored: true };
}

router.post('/trainings', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { title, description, attachmentUrl, attachment_url, attachmentName, attachment_name, deadline } = req.body;

  const finalTitle = textField(title, 200);
  const finalDescription = String(description ?? '').trim();
  const finalAttachmentName = textField(attachment_name ?? attachmentName, 200);

  if (!finalTitle || !finalDescription) {
    return res.status(400).json({ error: 'Гарчиг болон тайлбар шаардлагатай' });
  }
  if (finalTitle === null) return res.status(400).json({ error: 'Гарчиг хэт урт байна (200 тэмдэгт)' });
  if (finalAttachmentName === null) return res.status(400).json({ error: 'Файлын нэр хэт урт байна' });

  const rawUrl = String(attachment_url ?? attachmentUrl ?? '').trim();

  try {
    const id = uuidv4();
    await db('trainings').insert({
      id,
      title: finalTitle,
      description: finalDescription,
      attachment_url: null,
      attachment_name: finalAttachmentName || null,
      deadline: toSqlDateTime(deadline),
      author_id: req.user.id,
    });

    const attachment = await saveTrainingAttachment(id, rawUrl, finalAttachmentName || null);
    if ('error' in attachment && attachment.error) {
      await db('trainings').where({ id }).delete();
      return res.status(400).json({ error: attachment.error });
    }
    if (attachment.inline) {
      await db('trainings').where({ id }).update({ attachment_url: attachment.inline });
    }

    await logAction(req.user.id, 'CREATE_TRAINING', 'trainings', id, finalTitle, req);
    res.status(201).json({ id });
  } catch (err) {
    console.error('Create training error:', err);
    captureError('broadcasts: Create training error:', err);
    res.status(500).json({ error: 'Сургалт үүсгэхэд алдаа гарлаа' });
  }
});

router.put('/trainings/:id', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { id } = req.params;
  const { title, description, attachmentUrl, attachment_url, attachmentName, attachment_name, deadline } = req.body;

  const finalTitle = textField(title, 200);
  const finalAttachmentName = textField(attachment_name ?? attachmentName, 200);
  if (finalTitle === null) return res.status(400).json({ error: 'Гарчиг хэт урт байна (200 тэмдэгт)' });
  if (finalAttachmentName === null) return res.status(400).json({ error: 'Файлын нэр хэт урт байна' });

  try {
    const existing = await db('trainings').where({ id }).first();
    if (!existing) return res.status(404).json({ error: 'Сургалт олдсонгүй' });

    const updates: any = { updated_at: db.fn.now() };
    if (finalTitle) updates.title = finalTitle;
    if (description !== undefined) updates.description = String(description ?? '').trim();
    if (deadline !== undefined) updates.deadline = toSqlDateTime(deadline);
    if (finalAttachmentName !== undefined) updates.attachment_name = finalAttachmentName || null;

    const rawUrl = attachment_url ?? attachmentUrl;
    if (rawUrl !== undefined) {
      const attachment = await saveTrainingAttachment(id, String(rawUrl ?? '').trim(), finalAttachmentName || null);
      if ('error' in attachment && attachment.error) {
        return res.status(400).json({ error: attachment.error });
      }
      updates.attachment_url = attachment.inline || null;
      if (!attachment.stored && (await hasAttachmentTable())) {
        await db('training_attachments').where({ training_id: id }).delete();
      }
    }

    await db('trainings').where({ id }).update(updates);
    await logAction(req.user.id, 'UPDATE_TRAINING', 'trainings', id, updates.title || existing.title, req);
    res.json({ id });
  } catch (err) {
    console.error('Update training error:', err);
    captureError('broadcasts: Update training error:', err);
    res.status(500).json({ error: 'Сургалт шинэчлэхэд алдаа гарлаа' });
  }
});

// Fetched only when a material is actually opened, so the polled list stays
// small even when a material carries a multi-megabyte file.
router.get('/trainings/:id/attachment', authenticate, async (req: any, res) => {
  const { id } = req.params;
  try {
    const training = await db('trainings').where({ id }).first();
    if (!training) return res.status(404).json({ error: 'Сургалт олдсонгүй' });

    if (training.attachment_url) {
      return res.json({ attachmentUrl: training.attachment_url, attachmentName: training.attachment_name });
    }
    if (!(await hasAttachmentTable())) {
      return res.json({ attachmentUrl: '', attachmentName: training.attachment_name });
    }

    const stored = await db('training_attachments').where({ training_id: id }).first();
    res.json({
      attachmentUrl: stored?.data || '',
      attachmentName: stored?.name || training.attachment_name || '',
    });
  } catch (err) {
    console.error('Get training attachment error:', err);
    captureError('broadcasts: Get training attachment error:', err);
    res.status(500).json({ error: 'Хавсралт татахад алдаа гарлаа' });
  }
});

router.delete('/trainings/:id', authenticate, authorize(['admin', 'superadmin']), async (req: any, res) => {
  const { id } = req.params;
  try {
    const existing = await db('trainings').where({ id }).first();
    if (!existing) return res.status(404).json({ error: 'Сургалт олдсонгүй' });
    if (req.user.role !== 'superadmin' && existing.author_id && String(existing.author_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Зөвхөн өөрийн үүсгэсэн сургалтыг устгах боломжтой' });
    }

    await db('training_completions').where({ training_id: id }).delete();
    if (await hasAttachmentTable()) {
      await db('training_attachments').where({ training_id: id }).delete();
    }
    await db('trainings').where({ id }).delete();
    await logAction(req.user.id, 'DELETE_TRAINING', 'trainings', id, `Training deleted: ${existing.title}`, req);
    res.json({ message: 'Сургалт устгагдлаа' });
  } catch (err) {
    console.error('Delete training error:', err);
    captureError('broadcasts: Delete training error:', err);
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
      try {
        await db('training_completions').insert({
          training_id: finalTrainingId,
          user_id: userId,
          completed_at: db.fn.now(),
        });
      } catch (insertErr) {
        if (!isDuplicateKeyError(insertErr)) throw insertErr;
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Complete training error:', err);
    captureError('broadcasts: Complete training error:', err);
    res.status(500).json({ error: 'Сургалт дуусгахад алдаа гарлаа' });
  }
});

export default router;
