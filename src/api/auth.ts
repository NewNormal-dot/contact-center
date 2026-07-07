import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { authenticate } from '../middleware/auth';
import { logAction } from './audit';
import { getJwtSecret } from '../utils/jwtSecret';
import { buildPasswordSetupUrl, sendPasswordSetupEmail } from '../utils/email';
import { createPasswordSetupToken, hashPasswordSetupToken, validateNewPassword } from '../utils/password';
import { columnExists } from '../database/schemaUtils';

const router = express.Router();

async function hasPasswordSetupColumns() {
  return columnExists(db, 'users', 'password_setup_token_hash');
}

function formatUserForClient(user: any) {
  const { password_hash, password_setup_token_hash, ...userResult } = user;
  return {
    ...userResult,
    photoUrl: user.photo_url,
    employmentType: user.employment_type,
    weeklyRuleId: user.weekly_rule_id,
    createdAt: user.created_at,
    passwordChangedAt: user.password_changed_at,
    invitedAt: user.invited_at,
    invitationSentAt: user.invitation_sent_at,
  };
}

router.post('/change-password', authenticate, async (req: any, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.user.id;

  const validationError = validateNewPassword(newPassword);
  if (!oldPassword || validationError) {
    return res.status(400).json({ error: validationError || 'Одоогийн нууц үг шаардлагатай' });
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
    const updates: any = {
      password_hash: hashedPassword,
      updated_at: db.fn.now(),
    };

    if (await hasPasswordSetupColumns()) {
      updates.password_setup_token_hash = null;
      updates.password_setup_expires_at = null;
      updates.password_changed_at = db.fn.now();
    }

    await db('users').where({ id: userId }).update(updates);

    await logAction(userId, 'CHANGE_PASSWORD', 'users', userId, 'User changed their password');
    res.json({ message: 'Нууц үг амжилттай солигдлоо' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

router.post('/setup-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Нууц үг тохируулах холбоос буруу байна' });
  }

  const validationError = validateNewPassword(newPassword);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    if (!(await hasPasswordSetupColumns())) {
      return res.status(500).json({ error: 'Password setup migration хийгдээгүй байна' });
    }

    const tokenHash = hashPasswordSetupToken(String(token));
    const user = await db('users')
      .where({ password_setup_token_hash: tokenHash })
      .first();

    if (!user || !user.password_setup_expires_at) {
      return res.status(400).json({ error: 'Холбоос буруу эсвэл хүчингүй болсон байна' });
    }

    const expiresAt = new Date(user.password_setup_expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Холбоосын хүчинтэй хугацаа дууссан байна. Админаас дахин link илгээхийг хүснэ үү.' });
    }

    const hashedPassword = await bcrypt.hash(String(newPassword), 10);
    await db('users').where({ id: user.id }).update({
      password_hash: hashedPassword,
      password_setup_token_hash: null,
      password_setup_expires_at: null,
      password_changed_at: db.fn.now(),
      status: 'active',
      updated_at: db.fn.now(),
    });

    await logAction(user.id, 'SETUP_PASSWORD', 'users', user.id, `User set password via email setup link: ${user.email}`);
    res.json({ message: 'Нууц үг амжилттай тохирлоо. Одоо шинэ нууц үгээрээ нэвтэрнэ үү.' });
  } catch (err) {
    console.error('Setup Password Error:', err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'И-мэйл хаяг шаардлагатай' });
  }

  try {
    if (!(await hasPasswordSetupColumns())) {
      return res.status(500).json({ error: 'Password setup migration хийгдээгүй байна' });
    }

    const user = await db('users').where({ email }).first();
    if (user && user.status !== 'inactive') {
      const setup = createPasswordSetupToken();
      const setupUrl = buildPasswordSetupUrl(setup.token);

      await db('users').where({ id: user.id }).update({
        password_setup_token_hash: setup.tokenHash,
        password_setup_expires_at: setup.expiresAt,
        updated_at: db.fn.now(),
      });

      await sendPasswordSetupEmail({
        to: user.email,
        name: user.name,
        setupUrl,
        expiresAt: setup.expiresAt,
      });
      await db('users').where({ id: user.id }).update({ invitation_sent_at: db.fn.now(), updated_at: db.fn.now() });

      await logAction(user.id, 'REQUEST_PASSWORD_RESET', 'users', user.id, `Password setup link requested for ${user.email}`);
    }

    res.json({ message: 'Хэрэв энэ и-мэйл бүртгэлтэй бол нууц үг тохируулах холбоос илгээгдэнэ.' });
  } catch (err) {
    console.error('Forgot Password Error:', err);
    res.status(500).json({ error: 'Нууц үг сэргээх холбоос илгээхэд алдаа гарлаа' });
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
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    await logAction(user.id, 'LOGIN_SUCCESS', 'users', user.id, `User logged in: ${user.email}`);

    res.json({ token, user: formatUserForClient(user) });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

router.post('/register-initial', async (req, res) => {
  // Only use this for initial superadmin creation if none exists
  try {
    const initialEmail = process.env.INITIAL_SUPERADMIN_EMAIL;
    const initialPassword = process.env.INITIAL_SUPERADMIN_PASSWORD;

    if (!initialEmail || !initialPassword || initialPassword.length < 10) {
      return res.status(400).json({
        error: 'INITIAL_SUPERADMIN_EMAIL болон хамгийн багадаа 10 тэмдэгттэй INITIAL_SUPERADMIN_PASSWORD тохируулах шаардлагатай'
      });
    }

    const count = await db('users').count('id as count').first();
    if (count && Number(count.count) > 0) {
       return res.status(403).json({ error: 'Уучлаарай, систем аль хэдийн бүртгэлтэй байна' });
    }

    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(initialPassword, 10);
    const insertData: any = {
      id,
      email: initialEmail,
      password_hash: hashedPassword,
      name: 'Super Admin',
      role: 'superadmin',
      status: 'active',
      employment_type: 'Full Time'
    };

    if (await hasPasswordSetupColumns()) {
      insertData.password_changed_at = db.fn.now();
    }
    
    await db('users').insert(insertData);

    res.json({ message: 'Superadmin created successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

// Confirm current authenticated user's password (used for sensitive actions)
router.post('/confirm-password', authenticate, async (req: any, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });

  try {
    const user = await db('users').where({ id: req.user.id }).first();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(String(password), user.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid password' });

    res.json({ ok: true });
  } catch (err) {
    console.error('Confirm password error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
