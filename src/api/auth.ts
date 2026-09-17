import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db, { withDbRetry } from '../database/db';
import { authenticate } from '../middleware/auth';
import { logAction } from './audit';
import { getJwtSecret } from '../utils/jwtSecret';
import { buildPasswordSetupUrl, sendPasswordSetupEmail } from '../utils/email';
import { createPasswordSetupToken, hashPasswordSetupToken, validateNewPassword } from '../utils/password';
import { captureError } from '../utils/errorLog';
import { columnExists } from '../database/schemaUtils';
import { loginRateLimiter, forgotPasswordRateLimiter, setupPasswordRateLimiter, confirmPasswordRateLimiter } from '../middleware/rateLimiter';
import { invalidateAuthUserCache } from '../middleware/auth';

const router = express.Router();

// A real bcrypt hash of a value nobody can supply. Compared against when the
// email is unknown, so the unknown-account and wrong-password paths cost the
// same time and are indistinguishable from outside.
const DUMMY_BCRYPT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

async function hasPasswordSetupColumns() {
  return columnExists(db, 'users', 'password_setup_token_hash');
}

async function hasSessionCutoffColumn() {
  return columnExists(db, 'users', 'sessions_valid_from');
}

function issueToken(user: any) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    getJwtSecret(),
    { expiresIn: '24h' }
  );
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
    // Every session opened before now is dead. Without this, changing your
    // password left every other device - including an attacker's - signed in
    // for up to 24 hours.
    if (await hasSessionCutoffColumn()) {
      updates.sessions_valid_from = new Date();
    }

    await db('users').where({ id: userId }).update(updates);
    invalidateAuthUserCache(userId);

    await logAction(userId, 'CHANGE_PASSWORD', 'users', userId, 'User changed their password');
    // Hand the caller a token issued AFTER the cutoff so the session they are
    // sitting in survives while all the others are revoked.
    const refreshed = await db('users').where({ id: userId }).first();
    res.json({ message: 'Нууц үг амжилттай солигдлоо', token: issueToken(refreshed) });
  } catch (err) {
    console.error(err);
    captureError('auth: change-password', err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

router.post('/setup-password', setupPasswordRateLimiter, async (req, res) => {
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
    const setupUpdates: any = {
      password_hash: hashedPassword,
      password_setup_token_hash: null,
      password_setup_expires_at: null,
      password_changed_at: db.fn.now(),
      status: 'active',
      updated_at: db.fn.now(),
    };
    // An admin-initiated reset must eject whoever is already in the account.
    if (await hasSessionCutoffColumn()) setupUpdates.sessions_valid_from = new Date();

    await db('users').where({ id: user.id }).update(setupUpdates);
    invalidateAuthUserCache(user.id);

    await logAction(user.id, 'SETUP_PASSWORD', 'users', user.id, `User set password via email setup link: ${user.email}`);
    res.json({ message: 'Нууц үг амжилттай тохирлоо. Одоо шинэ нууц үгээрээ нэвтэрнэ үү.' });
  } catch (err) {
    console.error('Setup Password Error:', err);
    captureError('auth: Setup Password Error:', err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

router.post('/forgot-password', forgotPasswordRateLimiter, async (req, res) => {
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
    captureError('auth: Forgot Password Error:', err);
    res.status(500).json({ error: 'Нууц үг сэргээх холбоос илгээхэд алдаа гарлаа' });
  }
});

router.post('/login', loginRateLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'И-мэйл болон нууц үг шаардлагатай' });
  }

  try {
    // Everyone logs in within the same couple of minutes when booking opens,
    // which is exactly when Azure SQL is most likely to answer a connection
    // with a transient throttling error. Without a retry that surfaces as
    // "Дотоод алдаа гарлаа" on the login screen for something that would
    // have worked on the next attempt.
    const user = await withDbRetry(
      () => db('users').where({ email }).first(),
      { label: 'POST /api/auth/login' },
    );
    // One message for every failure, and bcrypt runs either way.
    //
    // Distinct messages ("Бүртгэлгүй эсвэл идэвхгүй хэрэглэгч" vs "Нууц үг
    // буруу байна") let anyone enumerate which corporate emails have
    // accounts, and skipping bcrypt entirely for an unknown address made the
    // two cases distinguishable by response time as well.
    const INVALID_CREDENTIALS = 'И-мэйл эсвэл нууц үг буруу байна';
    const passwordHash = user?.password_hash || DUMMY_BCRYPT_HASH;
    const isMatch = await bcrypt.compare(password, passwordHash);

    if (!user || user.status === 'inactive' || !isMatch) {
      return res.status(401).json({ error: INVALID_CREDENTIALS });
    }

    const token = issueToken(user);

    // Fire-and-forget: audit logging must never delay or break the login
    // response itself. logAction already catches its own errors internally,
    // so not awaiting it here is safe (it can't produce an unhandled
    // rejection or crash the process).
    void logAction(user.id, 'LOGIN_SUCCESS', 'users', user.id, `User logged in: ${user.email}`);

    res.json({ token, user: formatUserForClient(user) });
  } catch (err) {
    console.error('Login Error:', err);
    captureError('auth: Login Error:', err);
    captureError('POST /api/auth/login', err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа', details: process.env.NODE_ENV === 'production' ? undefined : (err as any)?.message });
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

    // Fix for check-then-insert race: two near-simultaneous requests could
    // previously both see "0 users" and both create a superadmin. Wrapping
    // in a transaction makes the check + insert atomic together. On Azure
    // SQL (mssql) we additionally take a transaction-scoped table lock so a
    // second concurrent request has to wait for the first to fully commit
    // before it can even read the count. On local sqlite dev this extra
    // hint is unnecessary (better-sqlite3 is a single synchronous
    // connection, so transactions are already effectively serialized).
    const result = await db.transaction(async (trx) => {
      const clientName = String((trx.client as any)?.config?.client || '').toLowerCase();
      if (clientName === 'mssql') {
        await trx.raw('SELECT TOP 1 1 AS x FROM users WITH (TABLOCKX, HOLDLOCK)');
      }

      const count = await trx('users').count('id as count').first();
      if (count && Number(count.count) > 0) {
        return { alreadyExists: true as const };
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
        insertData.password_changed_at = trx.fn.now();
      }

      await trx('users').insert(insertData);
      return { alreadyExists: false as const };
    });

    if (result.alreadyExists) {
      return res.status(403).json({ error: 'Уучлаарай, систем аль хэдийн бүртгэлтэй байна' });
    }

    res.json({ message: 'Superadmin created successfully.' });
  } catch (err) {
    console.error(err);
    captureError('auth: register-initial', err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

// Confirm current authenticated user's password (used for sensitive actions)
router.post('/confirm-password', authenticate, confirmPasswordRateLimiter, async (req: any, res) => {
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
    captureError('auth: Confirm password error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// There was no logout endpoint at all - signing out only cleared
// localStorage, leaving a fully valid token behind for up to 24 hours.
// This records the event, and on request revokes every session for the
// account (there is no per-token id, so "this device only" is not
// expressible; the client keeps doing its local clear for that case).
router.post('/logout', authenticate, async (req: any, res) => {
  const allDevices = req.body?.allDevices === true;
  try {
    if (allDevices && (await hasSessionCutoffColumn())) {
      await db('users').where({ id: req.user.id }).update({
        sessions_valid_from: new Date(),
        updated_at: db.fn.now(),
      });
      invalidateAuthUserCache(req.user.id);
    }
    await logAction(req.user.id, 'LOGOUT', 'users', req.user.id, allDevices ? 'Signed out of all devices' : 'Signed out');
    res.json({ ok: true, allDevices });
  } catch (err) {
    console.error('Logout error:', err);
    captureError('auth: logout', err);
    res.status(500).json({ error: 'Дотоод алдаа гарлаа' });
  }
});

export default router;
