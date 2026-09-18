import express from 'express';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { getRecentErrors } from '../utils/errorLog';
import { captureError } from '../utils/errorLog';
import { tableExists } from '../database/schemaUtils';
import { invalidatePendingMigrationCount } from '../utils/migrationStatus';
import { logAction } from './audit';

const router = express.Router();

// These two endpoints exist so a superadmin can diagnose and fix DB
// migration issues purely through the app itself (git push + login),
// without ever needing Azure Portal / RBAC access to view Configuration
// or Log Stream. Both are gated by the EXISTING superadmin JWT auth -
// no new secrets or environment variables are required.

// GET  /api/admin/migration-status - shows exactly which migrations have
// run and which are still pending, plus the real error if the last
// production migration attempt failed (normally hidden from clients).
router.get('/migration-status', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const [completed, pending] = await db.migrate.list();
    res.json({
      completed: (completed as any[]).map((m: any) => m.file || m.name || String(m)),
      pending: (pending as any[]).map((m: any) => m.file || m.name || String(m)),
    });
  } catch (err: any) {
    console.error('Migration status check failed:', err);
    captureError('admin: Migration status check failed:', err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// POST /api/admin/run-migrations - runs any pending knex migrations right
// now, against whichever DB this app instance is connected to (Azure SQL
// in production). Safe to call repeatedly: knex tracks which migrations
// already ran and only applies new ones.
router.post('/run-migrations', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const [batchNo, migrationsRun] = await db.migrate.latest();
    // /api/health caches the pending count; drop it so the operator who just
    // ran this sees the result immediately instead of being told the
    // migrations are still outstanding.
    invalidatePendingMigrationCount();
    console.log(`Manual migration trigger: batch ${batchNo}, ran: ${migrationsRun.join(', ') || '(none - already up to date)'}`);
    // The single most consequential operation this app exposes - it changes
    // the schema of the production database - and until now it left no trace
    // anywhere except a console line that App Service discards on restart.
    await logAction(
      (req as any).user?.id,
      'RUN_MIGRATIONS',
      'database',
      null,
      migrationsRun.length > 0
      ? `batch ${batchNo}: ${migrationsRun.join(', ')}`
      : 'no-op (already up to date)',
      req,
    );
    res.json({
      success: true,
      batchNo,
      migrationsRun,
      message: migrationsRun.length > 0
        ? `${migrationsRun.length} migration(s) applied.`
        : 'Аль хэдийн бүх migration хийгдсэн байна (шинээр хийх зүйл алга).',
    });
  } catch (err: any) {
    console.error('Manual migration trigger failed:', err);
    captureError('admin: Manual migration trigger failed:', err);
    await logAction(
      (req as any).user?.id,
      'RUN_MIGRATIONS_FAILED',
      'database',
      null,
      String(err?.message || err).slice(0, 500),
      req,
    ).catch(() => undefined);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// GET /api/admin/recent-errors - shows the last ~30 server-side errors
// (login failures, unhandled middleware errors, etc) with full messages
// and stack traces, so a superadmin can self-diagnose production issues
// (e.g. "Дотоод алдаа гарлаа" reports) without needing Azure Portal / Log
// Stream access. Held in memory only - resets on every deploy/restart.
router.get('/recent-errors', authenticate, authorize(['superadmin']), async (req, res) => {
  // In-memory first (always available, survives a database outage), then the
  // durable table if the migration has been applied. Before this, the ONLY
  // record of a server-side error was 30 entries in process memory, cleared
  // on every restart and deploy - so a complaint from last week could not be
  // investigated at all.
  const memory = getRecentErrors();

  try {
    if (!(await tableExists(db, 'server_errors'))) {
      return res.json({ source: 'memory', persisted: false, errors: memory });
    }

    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const stored = await db('server_errors')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .select('id', 'context', 'message', 'stack', 'created_at');

    res.json({
      source: 'database',
      persisted: true,
      errors: stored.map((row: any) => ({
        timestamp: row.created_at,
        context: row.context,
        message: row.message,
        stack: row.stack,
      })),
      recentInMemory: memory,
    });
  } catch (err) {
    console.error('Recent errors lookup failed:', err);
    res.json({ source: 'memory', persisted: false, errors: memory });
  }
});

export default router;
