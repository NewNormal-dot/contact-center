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

export function captureError(context: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  recentErrors.unshift({
    timestamp: new Date().toISOString(),
    context,
    message,
    stack,
  });
  if (recentErrors.length > MAX_ERRORS) {
    recentErrors.length = MAX_ERRORS;
  }
}

export function getRecentErrors() {
  return recentErrors;
}
