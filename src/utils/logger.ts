import { ActivityLog } from '../types';

/**
 * DEPRECATED - retained only so the ~40 existing call sites keep compiling.
 *
 * This used to write a parallel "activity log" into localStorage, guessing
 * the actor from `window.location.pathname` and recording the literal ids
 * 'admin' / 'csr' / 'superadmin'. It was per-browser, per-device fiction:
 * two admins never saw the same log, nothing a CSR did on their phone
 * appeared anywhere else, and the superadmin's Activity Log silently fell
 * back to it whenever GET /api/audit hiccuped - presenting one machine's
 * invented history as the organisation's audit trail.
 *
 * The real audit trail is the `audit_logs` table, written server-side by
 * logAction() in src/api/audit.ts, which is now called for every
 * state-changing operation. Client code cannot be trusted to record what the
 * server did, so this no longer records anything.
 *
 * Call sites are left in place intentionally: they read as documentation of
 * which user actions matter, and removing them would be a large diff with no
 * behavioural benefit. New code should NOT call this - if an action needs an
 * audit trail, log it on the server.
 */
export function logAction(action: string, details: string) {
  // Intentionally records nothing. Kept as a debug aid only.
  void action;
  void details;
}

/**
 * Clears the legacy per-browser log left behind by the old implementation, so
 * it cannot be mistaken for real data or keep consuming storage quota.
 */
export function purgeLegacyActivityLog() {
  try {
    localStorage.removeItem('activity_logs');
  } catch {
    // Storage may be unavailable; nothing here is load-bearing.
  }
}

export type { ActivityLog };
