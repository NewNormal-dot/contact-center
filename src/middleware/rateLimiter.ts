import { Request, Response, NextFunction } from 'express';

/**
 * Simple in-memory sliding-window rate limiter.
 *
 * NOTE: This stores counters in process memory. It works correctly for a
 * single server instance (e.g. one Azure App Service instance / one
 * container). If you ever scale out to multiple instances behind a load
 * balancer, each instance will track its own counts, so the effective
 * limit becomes (limit x number of instances). For most small/medium
 * deployments this is perfectly fine. If you need a shared limit across
 * multiple instances later, swap this out for a Redis-backed limiter
 * (e.g. the `rate-limiter-flexible` package with a Redis store).
 */

interface Bucket {
  count: number;
  firstRequestAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodically clean up old buckets so memory doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.firstRequestAt > 60 * 60 * 1000) {
      buckets.delete(key);
    }
  }
}, 15 * 60 * 1000).unref();

function getClientKey(req: Request): string {
  // X-Forwarded-For is a CLIENT-CONTROLLED header that the proxy APPENDS to.
  // Taking the FIRST entry therefore took whatever the caller put there,
  // which made the limiter trivially bypassable: send a different
  // X-Forwarded-For on every attempt and each one lands in its own bucket.
  //
  // The last entry is the hop closest to us - the one Azure App Service's
  // front end added - and is the only part a caller cannot forge.
  const forwarded = req.headers['x-forwarded-for'];
  const chain = Array.isArray(forwarded) ? forwarded.join(',') : forwarded || '';
  const hops = chain.split(',').map((hop) => hop.trim()).filter(Boolean);
  const nearest = hops.length > 0 ? hops[hops.length - 1] : '';
  // Azure includes a source port ("1.2.3.4:56789"); strip it so every attempt
  // from one address shares a bucket instead of getting a fresh one.
  const ip = nearest.replace(/:\d+$/, '');
  return ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Creates a rate-limiting middleware.
 *
 * @param options.windowMs   Time window in milliseconds (e.g. 15 minutes)
 * @param options.max        Max requests allowed per key within the window
 * @param options.keyPrefix  Prefix so different routes don't share buckets
 * @param options.message    Error message returned when limit is exceeded (Mongolian by default)
 */
export function rateLimiter(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
}) {
  const { windowMs, max, keyPrefix, message } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientKey(req);
    // Combine IP with the request body's email (if present) so a single
    // attacker can't just rotate emails from one IP to dodge the limit,
    // and legitimate users on a shared/office IP aren't blocked by someone
    // else's failed attempts on a *different* account.
    const emailPart = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
    const key = `${keyPrefix}:${ip}:${emailPart}`;

    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.firstRequestAt > windowMs) {
      buckets.set(key, { count: 1, firstRequestAt: now });
      return next();
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.ceil((bucket.firstRequestAt + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: message || 'Хэт олон удаа оролдлоо. Түр хүлээгээд дахин оролдоно уу.',
        retryAfterSeconds,
      });
    }

    bucket.count += 1;
    next();
  };
}

// Ready-to-use limiter for the login endpoint:
// 10 attempts per 15 minutes per (IP + email) combination.
export const loginRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'login',
  message: 'Хэт олон удаа буруу нэвтрэх оролдлого хийлээ. 15 минутын дараа дахин оролдоно уу.',
});

// Slightly looser limiter for password-reset requests to prevent email
// enumeration / spam, since these send real emails.
export const forgotPasswordRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'forgot-password',
  message: 'Хэт олон удаа хүсэлт илгээлээ. 15 минутын дараа дахин оролдоно уу.',
});

// Redeeming a password-setup link had NO limiter, so the 32-byte token could
// be guessed at unlimited speed. The token space makes that impractical, but
// an unlimited endpoint that hands out account access should not be the only
// thing standing in the way.
export const setupPasswordRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: 'setup-password',
  message: 'Хэт олон удаа оролдлоо. 15 минутын дараа дахин оролдоно уу.',
});

// /auth/confirm-password verifies the CURRENT password of an already
// authenticated session - i.e. it is a password oracle. It had no limiter at
// all, so a stolen token could be used to brute-force the password behind it.
export const confirmPasswordRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'confirm-password',
  message: 'Хэт олон удаа оролдлоо. 15 минутын дараа дахин оролдоно уу.',
});
