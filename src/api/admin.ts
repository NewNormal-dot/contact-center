import express from 'express';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';

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
    console.log(`Manual migration trigger: batch ${batchNo}, ran: ${migrationsRun.join(', ') || '(none - already up to date)'}`);
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
    res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;
