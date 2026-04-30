import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { logAction } from './audit';

const router = express.Router();

// Get all users (Superadmin only)
router.get('/', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const users = await db('users').select('id', 'email', 'name', 'role', 'status', 'photo_url', 'code', 'employment_type', 'weekly_rule_id', 'created_at');
    const formattedUsers = users.map(u => ({
      ...u,
      photoUrl: u.photo_url,
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
      .select('id', 'email', 'name', 'role', 'status', 'photo_url', 'code', 'employment_type', 'weekly_rule_id');
    const formattedUsers = users.map(u => ({
      ...u,
      photoUrl: u.photo_url,
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
  const { email, password, name, role, status, employment_type, employmentType, code } = req.body;
  const actingUserRole = req.user.role;
  const finalEmploymentType = employment_type || employmentType;

  // Business Rule: Admin can only create CSR. Superadmin can create anyone.
  if (actingUserRole === 'admin' && role !== 'csr') {
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
      role,
      status: status || 'active',
      employment_type: finalEmploymentType,
      code
    });

    await logAction(req.user.id, 'CREATE_USER', 'users', id, `Created user ${name} (${role})`);
    res.status(201).json({ id, email, name, role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Update User
router.put('/:id', authenticate, async (req: any, res) => {
  const { id } = req.params;
  const { name, status, employment_type, employmentType, code, role } = req.body;
  const actingUserRole = req.user.role;
  const finalEmploymentType = employment_type || employmentType;

  try {
    const userToUpdate = await db('users').where({ id }).first();
    if (!userToUpdate) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });

    // Business Rule: Admin can only manage CSR
    if (actingUserRole === 'admin' && userToUpdate.role !== 'csr') {
      return res.status(403).json({ error: 'Зөвхөн CSR хэрэглэгчийг засах боломжтой' });
    }

    const updates: any = { 
      name, 
      status, 
      employment_type: finalEmploymentType, 
      code, 
      updated_at: db.fn.now() 
    };
    if (actingUserRole === 'superadmin' && role) {
      updates.role = role;
    }

    await db('users').where({ id }).update(updates);
    await logAction(req.user.id, 'UPDATE_USER', 'users', id, `Updated user ${name} (${role || userToUpdate.role})`);
    res.json({ message: 'Амжилттай шинэчлэгдлээ' });
  } catch (err) {
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

// Reset Password (Superadmin/Root only)
router.post('/:id/reset-password', authenticate, authorize(['superadmin']), async (req: any, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const actingUser = req.user;

  try {
    const userToUpdate = await db('users').where({ id }).first();
    if (!userToUpdate) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });

    const isRoot = actingUser.email === 'enkhtur.a@mobicom.mn' || actingUser.email === 'Enkhtur040607@gmail.com';
    
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

    const isRoot = actingUser.email === 'enkhtur.a@mobicom.mn' || actingUser.email === 'Enkhtur040607@gmail.com';
    
    // ROLES DELETE RULES:
    // 1. Root user can delete ANYONE.
    // 2. Superadmin can delete Admin and CSR (but not other Superadmins).
    // 3. Admin can delete CSR ONLY.
    
    if (!isRoot) {
      if (actingUser.role === 'admin') {
        if (userToDelete.role !== 'csr') {
          return res.status(403).json({ error: 'Админ зөвхөн CSR хэрэглэгчийг устгах эрхтэй' });
        }
      } else if (actingUser.role === 'superadmin') {
        if (userToDelete.role === 'superadmin') {
          return res.status(403).json({ error: 'Супер админ өөр супер админыг устгах эрхгүй' });
        }
      } else {
        return res.status(403).json({ error: 'Устгах эрхгүй' });
      }
    }

    // Safety: Prevent deleting self (Optional, but usually good)
    if (actingUser.id === id) {
      return res.status(400).json({ error: 'Өөрийгөө устгах боломжгүй' });
    }

    await db('users').where({ id }).delete();
    await logAction(actingUser.id, 'DELETE_USER', 'users', id, `Deleted user ${userToDelete.email || userToDelete.name}`);
    res.json({ message: 'Хэрэглэгч амжилттай устгагдлаа' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Алдаа гарлаа' });
  }
});

export default router;
