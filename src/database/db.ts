import knex from 'knex';
import config from '../../knexfile';

const environment = process.env.NODE_ENV || 'development';
const selectedConfig = config[environment];

if (!selectedConfig) {
  throw new Error(`No Knex configuration found for NODE_ENV=${environment}`);
}

const db = knex(selectedConfig);

// Azure SQL regularly returns short-lived "transient" failures that are not
// application bugs: the database is failing over to another replica, the
// service tier is throttling a burst, or an idle pooled connection was
// closed by the load balancer in between requests. Microsoft's own guidance
// is that every client MUST retry these - without a retry the user just sees
// "Дотоод алдаа гарлаа" for something that would have worked 200ms later.
//
// These are the documented transient SQL error numbers plus the socket-level
// errors the tedious driver surfaces when a pooled connection went stale.
const TRANSIENT_SQL_ERROR_NUMBERS = new Set([
  4060,  // Cannot open database (still coming online)
  40197, // The service has encountered an error processing your request
  40501, // The service is currently busy (throttling)
  40613, // Database is currently unavailable (failover / resuming)
  49918, // Cannot process request. Not enough resources
  49919, // Cannot process create or update request. Too many operations
  49920, // Cannot process request. Too many operations in progress
  10928, // Resource ID limit reached
  10929, // Resource ID minimum guarantee not met
  10053, // A transport-level error (connection aborted by software)
  10054, // A transport-level error (connection reset by peer)
  10060, // Network-related / connection timeout
  233,   // No process is on the other end of the pipe
  64,    // A connection was successfully established but then failed
  20,    // The instance did not return a login response
]);

const TRANSIENT_ERROR_CODES = new Set([
  'ETIMEOUT',
  'ESOCKET',
  'ECONNRESET',
  'ECONNCLOSED',
  'EPIPE',
  'ENOTOPEN',
  'ETIMEDOUT',
]);

export function isTransientDbError(err: any): boolean {
  if (!err) return false;

  const candidates = [err, err.originalError, err.originalError?.info, err.precedingErrors?.[0]];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate.number === 'number' && TRANSIENT_SQL_ERROR_NUMBERS.has(candidate.number)) return true;
    if (typeof candidate.code === 'string' && TRANSIENT_ERROR_CODES.has(candidate.code)) return true;
  }

  // knex's own pool exhaustion message - the pool could not hand out a
  // connection in time because every one of them was busy. Retrying after a
  // short pause is exactly right: by then the burst has usually drained.
  const message = String(err.message || '');
  if (message.includes('Knex: Timeout acquiring a connection')) return true;
  if (message.includes('TimeoutError: Knex')) return true;

  return false;
}

/**
 * Runs a database operation, retrying it if (and only if) it fails with a
 * transient Azure SQL error.
 *
 * IMPORTANT: only use this for operations that are safe to run more than
 * once. Plain reads always are. A write is safe here only when it is inside
 * a transaction (a failed transaction is rolled back in full, so the retry
 * starts from a clean slate) or is otherwise idempotent.
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 150;

  let lastError: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isTransientDbError(err)) throw err;

      // Exponential backoff with a little jitter, so 200 clients that all
      // hit the same throttle do not then all retry at the same instant and
      // re-create the very burst that caused it.
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
      console.warn(
        `Transient DB error${options.label ? ` in ${options.label}` : ''} ` +
        `(attempt ${attempt}/${attempts}), retrying in ${delay}ms:`,
        (err as any)?.message || err,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export default db;
