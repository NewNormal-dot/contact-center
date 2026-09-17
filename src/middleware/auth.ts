import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db, { withDbRetry } from '../database/db';
import { getJwtSecret } from '../utils/jwtSecret';

// Every authenticated request used to run its own `SELECT * FROM users
// WHERE id = ?` round-trip to Azure SQL before the route handler even
// started. With the dashboards polling in the background, that alone
// accounted for one extra database query per request per user - hundreds
// per second during a booking rush, all asking for rows that had not
// changed.
//
// The row is now cached in process memory for a few seconds. The only
// fields read from it are role/email/name/status, which change rarely and
// only through this app's own endpoints - and those endpoints call
// invalidateAuthUserCache() so a role change, a deactivation or a delete
// takes effect immediately rather than after the TTL.
const AUTH_USER_CACHE_TTL_MS = Number(process.env.AUTH_USER_CACHE_TTL_MS || 15000);

interface CachedAuthUser {
  expiresAt: number;
  user: any | null;
}

const authUserCache = new Map<string, CachedAuthUser>();

/**
 * Drops a user (or everyone, when called with no argument) from the auth
 * cache. Call this from any endpoint that changes a user's role, status, or
 * existence so the change is reflected on the very next request.
 */
export function invalidateAuthUserCache(userId?: string) {
  if (userId) {
    authUserCache.delete(String(userId));
  } else {
    authUserCache.clear();
  }
}

// Keep the map from growing without bound over a long uptime. Entries are
// tiny, but this stays tidy regardless.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authUserCache.entries()) {
    if (entry.expiresAt <= now) authUserCache.delete(key);
  }
}, 60 * 1000).unref();

async function loadAuthUser(userId: string) {
  const cached = authUserCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const user = await withDbRetry(
    () => db('users').where({ id: userId }).first(),
    { label: 'authenticate:lookup' },
  );

  authUserCache.set(userId, {
    user: user || null,
    expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
  });

  return user || null;
}

export async function authenticate(req: any, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  // Token verification and the database lookup are deliberately in separate
  // try/catch blocks. Previously they shared one, so ANY failure - including
  // the database being briefly unreachable - was reported as "Invalid
  // token" (401). The API client treats 401 as "your session ended": it
  // wipes the stored token and redirects to the login screen. That turned a
  // few seconds of database trouble during a booking rush into every logged
  // -in user being thrown out of the app, which is exactly the "it randomly
  // logs me out / stops working when lots of people are on" symptom.
  let decoded: any;
  try {
    decoded = jwt.verify(token, getJwtSecret()) as any;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const dbUser = await loadAuthUser(String(decoded.id));

    if (!dbUser || dbUser.status === 'inactive') {
      return res.status(401).json({ error: 'Unauthorized or inactive user' });
    }

    // Session revocation. Tokens are self-contained 24h JWTs with no jti and
    // no blacklist, so before this check nothing could end a session early:
    // logging out left a valid token behind, and neither changing your
    // password nor an admin resetting a compromised account ejected whoever
    // was already inside it.
    //
    // `sessions_valid_from` is bumped on a password change/reset and on an
    // explicit "sign out everywhere"; any token issued before that instant is
    // dead. The column is added by a migration that production applies by
    // hand, so an undefined value simply means "no cutoff" and the check is a
    // no-op until it lands.
    const cutoff = dbUser.sessions_valid_from ? new Date(dbUser.sessions_valid_from).getTime() : NaN;
    if (Number.isFinite(cutoff) && typeof decoded.iat === 'number') {
      // jwt `iat` is whole seconds, so allow a second of slack rather than
      // logging out the very request that performed the change.
      if (decoded.iat * 1000 < cutoff - 1000) {
        return res.status(401).json({ error: 'Session expired' });
      }
    }

    req.user = {
      ...decoded,
      role: dbUser.role,
      email: dbUser.email,
      name: dbUser.name,
      status: dbUser.status,
    };
    next();
  } catch (err) {
    // A database problem is not an authentication problem: 503 keeps the
    // session alive and lets the client retry.
    console.error('Authentication lookup failed:', err);
    return res.status(503).json({ error: 'Түр зуурын алдаа гарлаа. Дахин оролдоно уу.' });
  }
}

export function authorize(roles: string[]) {
  return (req: any, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
