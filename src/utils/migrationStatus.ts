import db from '../database/db';

/**
 * How many migrations have not been applied yet.
 *
 * Production runs with SKIP_DB_MIGRATIONS=true and applies migrations by hand
 * (POST /api/admin/run-migrations), so the schema can sit behind the code -
 * and the only symptom is a generic 500 on whichever feature needed the
 * missing column. /api/health reports this count so that drift is visible
 * before a user trips over it.
 *
 * It was previously computed ONCE at startup and cached forever, which meant
 * that after an operator successfully applied the migrations, /api/health
 * kept insisting they were still pending - telling them the fix had not
 * worked when it had. Observed on 2026-09-17: run-migrations answered
 * "5 migration(s) applied." and health carried on reporting pending: 5.
 *
 * Now recomputed on demand behind a short TTL: fresh enough to reflect a
 * manual run within seconds, cheap enough that a polled health endpoint
 * cannot turn into a load problem. `invalidate()` makes an apply visible
 * immediately.
 */
const TTL_MS = Number(process.env.MIGRATION_STATUS_TTL_MS || 15_000);

let cachedCount: number | null = null;
let cachedAt = 0;
let inFlight: Promise<number | null> | null = null;

async function compute(): Promise<number | null> {
  try {
    const [, pending] = await db.migrate.list();
    return (pending as any[]).length;
  } catch (err: any) {
    // A database blip must never make the health endpoint fail - null simply
    // means "unknown", which is honest.
    console.error('Could not determine pending migrations:', err?.message || err);
    return null;
  }
}

export async function getPendingMigrationCount(): Promise<number | null> {
  if (cachedCount !== null && Date.now() - cachedAt < TTL_MS) return cachedCount;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const count = await compute();
      cachedCount = count;
      cachedAt = Date.now();
      return count;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Call after applying migrations so the next read reflects reality at once. */
export function invalidatePendingMigrationCount() {
  cachedCount = null;
  cachedAt = 0;
}
