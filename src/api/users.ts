import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { logAction } from './audit';

const router = express.Router();
const VALID_ROLES = new Set(['superadmin', 'admin', 'csr']);
const VALID_STATUSES = new Set(['active', 'inactive']);
const VALID_EMPLOYMENT_TYPES = new Set(['Full Time', 'Part Time']);
const DEFAULT_SEGMENTS_BY_ROLE: Record<string, string> = {
  superadmin: 'System Control',
  admin: 'Supervisor',
  csr: '',
};

function isValidRole(value: unknown): value is 'superadmin' | 'admin' | 'csr' {
  return typeof value === 'string' && VALID_ROLES.has(value);
}

function isValidStatus(value: unknown): value is 'active' | 'inactive' {
  return typeof value === 'string' && VALID_STATUSES.has(value);
}

function isValidEmploymentType(value: unknown): value is 'Full Time' | 'Part Time' {
  return typeof value === 'string' && VALID_EMPLOYMENT_TYPES.has(value);
}

function normalizeEmploymentType(value: unknown, fallback: 'Full Time' | 'Part Time' = 'Full Time') {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === 'admin' || value === 'superadmin') return 'Full Time';
  return value;
}

// Get all users (Superadmin only)
router.get('/', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const users = await db('users').select('id', 'email', 'name', 'role', 'status', 'photo_url', 'code', 'segment', 'employment_type', 'weekly_rule_id', 'created_at');
    const formattedUsers = users.map(u => ({
      ...u,
      photoUrl: u.photo_url,
      lineType: u.segment || DEFAULT_SEGMENTS_BY_ROLE[u.role] || '',
      employmentType: u.employment_type,
      weeklyRuleId: u.weekly_rule_id,
      createdAt: u.created_at
    }));
    res.json(formattedUsers);
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Get CSR users (Admin and Superadmin)
router.get('/csr', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const users = await db('users')
      .where({ role: 'csr' })
      .select('id', 'email', 'name', 'role', 'status', 'photo_url', 'code', 'segment', 'employment_type', 'weekly_rule_id');
    const formattedUsers = users.map(u => ({
      ...u,
      photoUrl: u.photo_url,
      lineType: u.segment || '',
      employmentType: u.employment_type,
      weeklyRuleId: u.weekly_rule_id
    }));
    res.json(formattedUsers);
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Create User
router.post('/', authenticate, async (req: any, res) => {
  const { email, password, name, role, status, employment_type, employmentType, code, segment, lineType } = req.body;
  const actingUserRole = req.user.role;
  const finalRole = role || 'csr';
  const finalStatus = status || 'active';
  const finalEmploymentType = normalizeEmploymentType(employment_type ?? employmentType);
  const finalSegment = segment ?? lineType ?? DEFAULT_SEGMENTS_BY_ROLE[finalRole] ?? '';

  if (!email || !name) {
    return res.status(400).json({ error: 'И-мэйл болон нэр шаардлагатай' });
  }

  if (!isValidRole(finalRole)) {
    return res.status(400).json({ error: 'Хэрэглэгчийн эрх буруу байна' });
  }

  if (!isValidStatus(finalStatus)) {
    return res.status(400).json({ error: 'Хэрэглэгчийн төлөв буруу байна' });
  }

  if (!isValidEmploymentType(finalEmploymentType)) {
    return res.status(400).json({ error: 'Ажлын төрөл буруу байна' });
  }

  // Business Rule: Admin can only create CSR. Superadmin can create anyone.
  if (actingUserRole === 'admin' && finalRole !== 'csr') {
    return res.status(403).json({ error: 'Админ зөвхөн CSR бүртгэх эрхтэй' });
  }

  if (actingUserRole !== 'superadmin' && actingUserRole !== 'admin') {
    return res.status(403).json({ error: 'Хандах эрхгүй' });
  }

  try {
    const existing = await db('users').where({ email }).first();
    if (existing) return res.status(400).json({ error: 'Имэйл бүртгэлтэй байна' });

    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(password || 'Password@123', 10);

    await db('users').insert({
      id,
      email,
      password_hash: hashedPassword,
      name,
      role: finalRole,
      status: finalStatus,
      employment_type: finalEmploymentType,
      segment: finalSegment || null,
      code
    });

    await logAction(req.user.id, 'CREATE_USER', 'users', id, `Created user ${name} (${finalRole})`);
    res.status(201).json({ id, email, name, role: finalRole, status: finalStatus, lineType: finalSegment, employmentType: finalEmploymentType, code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Update User
router.put('/:id', authenticate, async (req: any, res) => {
  const { id } = req.params;
  const { name, status, employment_type, employmentType, code, role, segment, lineType } = req.body;
  const actingUserRole = req.user.role;
  const requestedEmploymentType = employment_type ?? employmentType;
  const finalEmploymentType = requestedEmploymentType === undefined ? undefined : normalizeEmploymentType(requestedEmploymentType);
  const finalSegment = segment ?? lineType;

  if (actingUserRole !== 'superadmin' && actingUserRole !== 'admin') {
    return res.status(403).json({ error: 'Хандах эрхгүй' });
  }

  try {
    const userToUpdate = await db('users').where({ id }).first();
    if (!userToUpdate) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });

    // Business Rule: Admin can only manage CSR
    if (actingUserRole === 'admin' && userToUpdate.role !== 'csr') {
      return res.status(403).json({ error: 'Зөвхөн CSR хэрэглэгчийг засах боломжтой' });
    }

    const updates: any = {};

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Нэр хоосон байж болохгүй' });
      updates.name = name;
    }

    if (status !== undefined) {
      if (!isValidStatus(status)) return res.status(400).json({ error: 'Хэрэглэгчийн төлөв буруу байна' });
      updates.status = status;
    }

    if (finalEmploymentType !== undefined) {
      if (!isValidEmploymentType(finalEmploymentType)) return res.status(400).json({ error: 'Ажлын төрөл буруу байна' });
      updates.employment_type = finalEmploymentType;
    }

    if (code !== undefined) {
      updates.code = code || null;
    }

    if (finalSegment !== undefined) {
      updates.segment = finalSegment || null;
    }

    if (actingUserRole === 'superadmin' && role !== undefined) {
      if (!isValidRole(role)) return res.status(400).json({ error: 'Хэрэглэгчийн эрх буруу байна' });
      updates.role = role;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Шинэчлэх мэдээлэл алга' });
    }

    updates.updated_at = db.fn.now();

    await db('users').where({ id }).update(updates);
    await logAction(req.user.id, 'UPDATE_USER', 'users', id, `Updated user ${updates.name || userToUpdate.name} (${updates.role || userToUpdate.role})`);
    res.json({ message: 'Амжилттай шинэчлэгдлээ' });
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Reset Password: Superadmin can reset users; admin can reset CSR users only.
router.post('/:id/reset-password', authenticate, authorize(['superadmin', 'admin']), async (req: any, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const actingUser = req.user;

  try {
    const userToUpdate = await db('users').where({ id }).first();
    if (!userToUpdate) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });

    const isRoot = actingUser.email === 'enkhtur.a@mobicom.mn' || actingUser.email === 'Enkhtur040607@gmail.com';

    if (actingUser.role === 'admin' && userToUpdate.role !== 'csr') {
      return res.status(403).json({ error: 'Админ зөвхөн CSR хэрэглэгчийн нууц үгийг солих эрхтэй' });
    }
    
    // Rule: Superadmin cannot reset other Superadmin's password unless they are Root
    if (userToUpdate.role === 'superadmin' && !isRoot && actingUser.id !== id) {
      return res.status(403).json({ error: 'Та өөр супер админы нууц үгийг солих эрхгүй' });
    }

    const hashedPassword = await bcrypt.hash(password || 'Password@123', 10);
    await db('users').where({ id }).update({ 
      password_hash: hashedPassword,
      updated_at: db.fn.now()
    });

    await logAction(actingUser.id, 'RESET_PASSWORD', 'users', id, `Reset password for ${userToUpdate.email || userToUpdate.name}`);
    res.json({ message: 'Нууц үг амжилттай солигдлоо' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Delete User
router.delete('/:id', authenticate, async (req: any, res) => {
  const { id } = req.params;
  const actingUser = req.user; // { id, email, role }

  try {
    const userToDelete = await db('users').where({ id }).first();
    if (!userToDelete) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });

    const canDeleteUser =
      actingUser.role === 'superadmin' ||
      (actingUser.role === 'admin' && userToDelete.role === 'csr');
    
    // Delete rules:
    // 1. Superadmin can delete users with any role.
    // 2. Admin can delete CSR users only.
    
    if (!canDeleteUser) {
      if (actingUser.role === 'admin') {
        return res.status(403).json({ error: 'Админ зөвхөн CSR хэрэглэгчийг устгах эрхтэй' });
      }

      return res.status(403).json({ error: 'Устгах эрхгүй' });
    }

    // Safety: Prevent deleting self (Optional, but usually good)
    if (actingUser.id === id) {
      return res.status(400).json({ error: 'Өөрийгөө устгах боломжгүй' });
    }

    await db.transaction(async (trx) => {
      await trx('audit_logs').where({ user_id: id }).update({ user_id: null });
      await trx('notifications').where({ author_id: id }).update({ author_id: null });
      await trx('trainings').where({ author_id: id }).update({ author_id: null });
      await trx('leave_requests').where({ approved_by: id }).update({ approved_by: null });
      await trx('vacation_requests').where({ approved_by: id }).update({ approved_by: null });
      await trx('trade_requests')
        .where({ sender_id: id })
        .orWhere({ receiver_id: id })
        .orWhere({ approved_by: id })
        .update({
          sender_id: trx.raw('case when sender_id = ? then null else sender_id end', [id]),
          receiver_id: trx.raw('case when receiver_id = ? then null else receiver_id end', [id]),
          approved_by: trx.raw('case when approved_by = ? then null else approved_by end', [id]),
        });
      await trx('users').where({ id }).delete();
    });
    await logAction(actingUser.id, 'DELETE_USER', 'users', id, `Deleted user ${userToDelete.email || userToDelete.name}`);
    res.json({ message: 'Хэрэглэгч амжилттай устгагдлаа' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

export default router;
