import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate } from '../middleware/auth';
import { logAction } from './audit';
import { getJwtSecret } from '../utils/jwtSecret';

const router = express.Router();
const JWT_SECRET = getJwtSecret();

router.post('/change-password', authenticate, async (req: any, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!oldPassword || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой' });
  }

  try {
    const user = await db('users').where({ id: userId }).first();
    if (!user) {
      return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Одоогийн нууц үг буруу байна' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db('users').where({ id: userId }).update({
      password_hash: hashedPassword
    });

    await logAction(userId, 'CHANGE_PASSWORD', 'users', userId, 'User changed their password');
    res.json({ message: 'Нууц үг амжилттай солигдлоо' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'И-мэйл болон нууц үг шаардлагатай' });
  }

  try {
    const user = await db('users').where({ email }).first();
    if (!user || user.status === 'inactive') {
      return res.status(401).json({ error: 'Бүртгэлгүй эсвэл идэвхгүй хэрэглэгч' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Нууц үг буруу байна' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logAction(user.id, 'LOGIN_SUCCESS', 'users', user.id, `User logged in: ${user.email}`);

    const { password_hash, ...userResult } = user;
    const formattedUser = {
      ...userResult,
      photoUrl: user.photo_url,
      employmentType: user.employment_type,
      weeklyRuleId: user.weekly_rule_id,
      createdAt: user.created_at
    };
    res.json({ token, user: formattedUser });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

router.post('/register-initial', async (req, res) => {
  // Only use this for initial superadmin creation if none exists
  try {
    const count = await db('users').count('id as count').first();
    if (count && Number(count.count) > 0) {
       return res.status(403).json({ error: 'Уучлаарай, систем аль хэдийн бүртгэлтэй байна' });
    }

    const id = uuidv4();
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    
    await db('users').insert({
      id,
      email: 'superadmin@example.com',
      password_hash: hashedPassword,
      name: 'Super Admin',
      role: 'superadmin',
      status: 'active',
      employment_type: 'Full Time'
    });

    res.json({ message: 'Superadmin created successfully. Use email: superadmin@example.com and password: Admin@123' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

export default router;
