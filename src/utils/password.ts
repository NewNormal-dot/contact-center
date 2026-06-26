import crypto from 'node:crypto';

export const PASSWORD_SETUP_TOKEN_TTL_HOURS = Number(process.env.PASSWORD_SETUP_TOKEN_TTL_HOURS || 24);

export function createPasswordSetupToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashPasswordSetupToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_SETUP_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  return { token, tokenHash, expiresAt };
}

export function hashPasswordSetupToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function validateNewPassword(password: unknown) {
  const value = String(password || '');
  if (value.length < 8) {
    return 'Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой';
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Нууц үг том үсэг, жижиг үсэг, тоо агуулсан байх ёстой';
  }
  return null;
}

export function createLockedPasswordValue() {
  return crypto.randomBytes(48).toString('base64url');
}
