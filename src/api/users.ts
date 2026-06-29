import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { buildPasswordSetupUrl, sendPasswordSetupEmail } from '../utils/email';
import { createLockedPasswordValue, createPasswordSetupToken } from '../utils/password';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { logAction } from './audit';
import { columnExists } from '../database/schemaUtils';

const router = express.Router();
const VALID_ROLES = new Set(['superadmin', 'admin', 'csr']);
const VALID_STATUSES = new Set(['active', 'inactive']);
const VALID_EMPLOYMENT_TYPES = new Set(['Full Time', 'Part Time']);
const VALID_LOCATIONS = new Set(['Ulaanbaatar', 'Darkhan']);
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

function normalizeLocation(value: unknown) {
  const normalized = String(value ?? '').trim();
  return Array.from(VALID_LOCATIONS).find((location) => location.toLowerCase() === normalized.toLowerCase()) || '';
}

async function hasUserLocationColumn() {
  return columnExists(db, 'users', 'location');
}

async function hasUserSupervisorNameColumn() {
  return columnExists(db, 'users', 'supervisor_name');
}

async function hasPasswordSetupColumns() {
  return columnExists(db, 'users', 'password_setup_token_hash');
}

function userSelectColumns(includeLocation: boolean, includeSupervisorName: boolean, includeCreatedAt = false) {
  return [
    'id',
    'email',
    'name',
    'role',
    'status',
    'photo_url',
    'code',
    ...(includeLocation ? ['location'] : []),
    ...(includeSupervisorName ? ['supervisor_name'] : []),
    'segment',
    'employment_type',
    'weekly_rule_id',
    ...(includeCreatedAt ? ['created_at'] : []),
  ];
}

// Get all users (Superadmin only)
router.get('/', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const includeLocation = await hasUserLocationColumn();
    const includeSupervisorName = await hasUserSupervisorNameColumn();
    const users = await db('users').select(userSelectColumns(includeLocation, includeSupervisorName, true));
    const formattedUsers = users.map(u => ({
      ...u,
      location: includeLocation ? u.location : '',
      supervisorName: includeSupervisorName ? u.supervisor_name || '' : '',
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
    const includeLocation = await hasUserLocationColumn();
    const includeSupervisorName = await hasUserSupervisorNameColumn();
    const users = await db('users')
      .where({ role: 'csr' })
      .select(userSelectColumns(includeLocation, includeSupervisorName));
    const formattedUsers = users.map(u => ({
      ...u,
      location: includeLocation ? u.location : '',
      supervisorName: includeSupervisorName ? u.supervisor_name || '' : '',
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
  const { email, name, role, status, employment_type, employmentType, code, location, segment, lineType, supervisorName, supervisor_name } = req.body;
  const actingUserRole = req.user.role;
  const finalRole = role || 'csr';
  const finalStatus = status || 'active';
  const finalEmploymentType = normalizeEmploymentType(employment_type ?? employmentType);
  const requestedSegment = segment ?? lineType ?? DEFAULT_SEGMENTS_BY_ROLE[finalRole] ?? '';

  if (!email || !name) {
    return res.status(400).json({ error: 'И-мэйл болон нэр шаардлагатай' });
  }

  if (!isValidRole(finalRole)) {
    return res.status(400).json({ error: 'Хэрэглэгчийн эрх буруу байна' });
  }

  const finalSegment = finalRole === 'superadmin'
    ? DEFAULT_SEGMENTS_BY_ROLE.superadmin
    : String(requestedSegment || '').trim();

  if ((finalRole === 'admin' || finalRole === 'csr') && !finalSegment) {
    return res.status(400).json({ error: 'Сегмент шаардлагатай' });
  }

  if (!isValidStatus(finalStatus)) {
    return res.status(400).json({ error: 'Хэрэглэгчийн төлөв буруу байна' });
  }

  if (!isValidEmploymentType(finalEmploymentType)) {
    return res.status(400).json({ error: 'Ажлын төрөл буруу байна' });
  }

  const finalLocation = finalRole === 'csr' ? normalizeLocation(location) : normalizeLocation(location) || null;
  if (finalRole === 'csr' && !finalLocation) {
    return res.status(400).json({ error: 'Location заавал Ulaanbaatar эсвэл Darkhan байна' });
  }

  const finalSupervisorName = String(supervisorName ?? supervisor_name ?? '').trim();
  if (finalRole === 'csr' && !finalSupervisorName) {
    return res.status(400).json({ error: 'Ахлах ажилтны нэр шаардлагатай' });
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

    if (!(await hasPasswordSetupColumns())) {
      return res.status(500).json({ error: 'Password setup migration хийгдээгүй байна' });
    }

    const id = uuidv4();
    const setup = createPasswordSetupToken();
    const setupUrl = buildPasswordSetupUrl(setup.token);
    const lockedPasswordHash = await bcrypt.hash(createLockedPasswordValue(), 10);
    const includeLocation = await hasUserLocationColumn();
    const includeSupervisorName = await hasUserSupervisorNameColumn();

    await db.transaction(async (trx) => {
      const insertData: any = {
        id,
        email,
        password_hash: lockedPasswordHash,
        password_setup_token_hash: setup.tokenHash,
        password_setup_expires_at: setup.expiresAt,
        invited_at: trx.fn.now(),
        name,
        role: finalRole,
        status: finalStatus,
        employment_type: finalEmploymentType,
        segment: finalSegment || null,
        code,
      };

      if (includeLocation) {
        insertData.location = finalLocation || null;
      }

      if (includeSupervisorName) {
        insertData.supervisor_name = finalSupervisorName || null;
      }

      await trx('users').insert(insertData);
    });

    let invitationSent = false;
    try {
      await sendPasswordSetupEmail({
        to: email,
        name,
        setupUrl,
        expiresAt: setup.expiresAt,
      });
      await db('users').where({ id }).update({ invitation_sent_at: db.fn.now(), updated_at: db.fn.now() });
      invitationSent = true;
    } catch (emailErr) {
      console.error('Create user invite email failed:', emailErr);
    }

    await logAction(
      req.user.id,
      'CREATE_USER_INVITE',
      'users',
      id,
      invitationSent
        ? `Created user ${name} (${finalRole}) and sent password setup link to ${email}`
        : `Created user ${name} (${finalRole}); password setup email failed for ${email}`
    );
    res.status(201).json({
      id,
      email,
      name,
      role: finalRole,
      status: finalStatus,
      lineType: finalSegment,
      employmentType: finalEmploymentType,
      code,
      location: finalLocation || '',
      supervisorName: finalSupervisorName || '',
      invitationSent,
      message: invitationSent
        ? 'Хэрэглэгч үүсэж, нууц үг тохируулах холбоос и-мэйлээр илгээгдлээ'
        : 'Хэрэглэгч үүссэн боловч и-мэйл илгээгдсэнгүй. Reset товчоор холбоосыг дахин илгээнэ үү.',
    });
  } catch (err) {
    console.error('Create User Invite Error:', err);
    res.status(500).json({ error: 'Хэрэглэгч үүсгэх эсвэл invitation и-мэйл илгээхэд алдаа гарлаа' });
  }
});

// Update User
router.put('/:id', authenticate, async (req: any, res) => {
  const { id } = req.params;
  const { name, status, employment_type, employmentType, code, location, role, segment, lineType, supervisorName, supervisor_name } = req.body;
  const actingUserRole = req.user.role;
  const requestedEmploymentType = employment_type ?? employmentType;
  const finalEmploymentType = requestedEmploymentType === undefined ? undefined : normalizeEmploymentType(requestedEmploymentType);
  const requestedSegment = segment ?? lineType;

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

    if (actingUserRole === 'superadmin' && role !== undefined && !isValidRole(role)) {
      return res.status(400).json({ error: 'Хэрэглэгчийн эрх буруу байна' });
    }

    const effectiveRole = actingUserRole === 'superadmin' && role !== undefined ? role : userToUpdate.role;
    const segmentSource = requestedSegment !== undefined ? requestedSegment : userToUpdate.segment;
    const finalSegment = effectiveRole === 'superadmin'
      ? DEFAULT_SEGMENTS_BY_ROLE.superadmin
      : requestedSegment !== undefined
        ? String(requestedSegment || '').trim()
        : undefined;

    if ((effectiveRole === 'admin' || effectiveRole === 'csr') && !String(segmentSource || '').trim()) {
      return res.status(400).json({ error: 'Сегмент шаардлагатай' });
    }

    const updates: any = {};
    const includeLocation = await hasUserLocationColumn();
    const includeSupervisorName = await hasUserSupervisorNameColumn();
    const finalLocation = location === undefined ? undefined : normalizeLocation(location);
    if (includeLocation && location !== undefined && effectiveRole === 'csr' && !finalLocation) {
      return res.status(400).json({ error: 'Location заавал Ulaanbaatar эсвэл Darkhan байна' });
    }

    const requestedSupervisorName = supervisorName ?? supervisor_name;
    const finalSupervisorName = requestedSupervisorName === undefined ? undefined : String(requestedSupervisorName || '').trim();
    if (includeSupervisorName && requestedSupervisorName !== undefined && effectiveRole === 'csr' && !finalSupervisorName) {
      return res.status(400).json({ error: 'Ахлах ажилтны нэр шаардлагатай' });
    }

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

    if (includeLocation && location !== undefined) {
      updates.location = finalLocation || null;
    }

    if (includeSupervisorName && requestedSupervisorName !== undefined) {
      updates.supervisor_name = finalSupervisorName || null;
    }

    if (finalSegment !== undefined) {
      updates.segment = finalSegment || null;
    }

    if (actingUserRole === 'superadmin' && role !== undefined) {
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
// This does not expose a password to admins. It sends a secure setup link to the user's email.
router.post('/:id/reset-password', authenticate, authorize(['superadmin', 'admin']), async (req: any, res) => {
  const { id } = req.params;
  const actingUser = req.user;

  try {
    if (!(await hasPasswordSetupColumns())) {
      return res.status(500).json({ error: 'Password setup migration хийгдээгүй байна' });
    }

    const userToUpdate = await db('users').where({ id }).first();
    if (!userToUpdate) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });

    const isRoot = actingUser.email === 'enkhtur.a@mobicom.mn' || actingUser.email === 'Enkhtur040607@gmail.com';

    if (actingUser.role === 'admin' && userToUpdate.role !== 'csr') {
      return res.status(403).json({ error: 'Админ зөвхөн CSR хэрэглэгчийн нууц үгийг сэргээх эрхтэй' });
    }
    
    // Rule: Superadmin cannot reset other Superadmin's password unless they are Root
    if (userToUpdate.role === 'superadmin' && !isRoot && actingUser.id !== id) {
      return res.status(403).json({ error: 'Та өөр супер админы нууц үгийг сэргээх эрхгүй' });
    }

    const setup = createPasswordSetupToken();
    const setupUrl = buildPasswordSetupUrl(setup.token);

    await db('users').where({ id }).update({
      password_setup_token_hash: setup.tokenHash,
      password_setup_expires_at: setup.expiresAt,
      updated_at: db.fn.now(),
    });

    try {
      await sendPasswordSetupEmail({
        to: userToUpdate.email,
        name: userToUpdate.name,
        setupUrl,
        expiresAt: setup.expiresAt,
      });
      await db('users').where({ id }).update({ invitation_sent_at: db.fn.now(), updated_at: db.fn.now() });
    } catch (emailErr) {
      console.error('Reset password link email failed:', emailErr);
      return res.status(502).json({ error: 'Нууц үг тохируулах холбоос үүссэн боловч и-мэйл илгээхэд алдаа гарлаа. Дахин оролдоно уу.' });
    }

    await logAction(actingUser.id, 'SEND_PASSWORD_SETUP_LINK', 'users', id, `Sent password setup link to ${userToUpdate.email || userToUpdate.name}`);
    res.json({ message: 'Нууц үг тохируулах холбоос хэрэглэгчийн и-мэйл рүү илгээгдлээ' });
  } catch (err) {
    console.error('Reset Password Link Error:', err);
    res.status(500).json({ error: 'Нууц үг тохируулах холбоос илгээхэд алдаа гарлаа' });
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
