// In-memory ring buffer of recent server-side errors, so a superadmin can
// self-diagnose production issues (e.g. "Дотоод алдаа гарлаа" on login)
// through the app itself, without needing Azure Portal / Log Stream access.
// This is intentionally NOT persisted to the database (no schema change,
// no risk to real data) - it's just a rolling window of the last N errors
// held in the running process's memory, cleared on every restart/deploy.

interface CapturedError {
  timestamp: string;
  context: string;
  message: string;
  stack?: string;
}

const MAX_ERRORS = 30;
const recentErrors: CapturedError[] = [];

// Persisting is best-effort and deliberately decoupled: recording an error
// must never throw a second one, and must never delay the response. The
// in-memory ring stays as the zero-dependency fast path.
let persistEnabled: boolean | null = null;

async function persistError(entry: CapturedError) {
  try {
    const [{ default: db }, { tableExists }, { v4: uuidv4 }] = await Promise.all([
      import('../database/db'),
      import('../database/schemaUtils'),
      import('uuid'),
    ]);

    if (persistEnabled === null) {
      persistEnabled = await tableExists(db, 'server_errors');
    }
    if (!persistEnabled) return;

    await db('server_errors').insert({
      id: uuidv4(),
      context: entry.context.slice(0, 200),
      message: entry.message.slice(0, 4000),
      stack: entry.stack ? entry.stack.slice(0, 8000) : null,
      created_at: entry.timestamp,
    });
  } catch {
    // Swallowed on purpose - see above.
  }
}

export function captureError(context: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const entry: CapturedError = {
    timestamp: new Date().toISOString(),
    context,
    message,
    stack,
  };

  recentErrors.unshift(entry);
  if (recentErrors.length > MAX_ERRORS) {
    recentErrors.length = MAX_ERRORS;
  }

  // Fire and forget. The in-memory copy is already recorded, so a database
  // problem here costs nothing.
  void persistError(entry);
}

export function getRecentErrors() {
  return recentErrors;
}
