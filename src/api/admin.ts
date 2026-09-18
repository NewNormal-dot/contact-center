import express from 'express';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';
import { getRecentErrors } from '../utils/errorLog';
import { captureError } from '../utils/errorLog';
import { tableExists } from '../database/schemaUtils';
import { invalidatePendingMigrationCount } from '../utils/migrationStatus';
import { logAction } from './audit';
import { SLOT_IDENTITY_COLUMNS, SLOT_UNIQUE_INDEX, SLOT_NONUNIQUE_INDEX } from '../database/slotIdentity';
import { displayDate, displayTime } from '../utils/sqlDate';

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

// ===== Duplicate shifts =====
//
// Migration 20260918007000 adds a unique index on a shift's identity, but
// refuses to make it UNIQUE if duplicates already exist - deleting them
// automatically could destroy shifts people are booked onto. Production
// turned out to have 6 such groups, so these two endpoints exist to look at
// them and merge them deliberately.

type SlotRow = Record<string, any>;

function identityOf(row: SlotRow) {
  return SLOT_IDENTITY_COLUMNS.map((c) => String(row[c])).join('|');
}

function describeSlot(row: SlotRow) {
  const rest = row.is_rest === true || row.is_rest === 1;
  return `${displayDate(row.date)} ${rest ? 'Амралт' : `${displayTime(row.start_time)}-${displayTime(row.end_time)}`} ` +
    `${row.segment}/${row.employment_type}/${row.location}`;
}

/** Groups of work_slots rows sharing one identity, with their booking counts. */
async function findDuplicateGroups(conn: any) {
  const grouped = await conn('work_slots')
    .select(SLOT_IDENTITY_COLUMNS as unknown as string[])
    .count({ n: '*' })
    .groupBy(SLOT_IDENTITY_COLUMNS as unknown as string[])
    .havingRaw('count(*) > 1');

  if (grouped.length === 0) return [];

  // One query for every candidate row rather than one per group.
  const wanted = new Set(grouped.map(identityOf));
  const allRows: SlotRow[] = await conn('work_slots').select('*');
  const rowsByIdentity = new Map<string, SlotRow[]>();
  for (const row of allRows) {
    const key = identityOf(row);
    if (!wanted.has(key)) continue;
    if (!rowsByIdentity.has(key)) rowsByIdentity.set(key, []);
    rowsByIdentity.get(key)!.push(row);
  }

  const slotIds = [...rowsByIdentity.values()].flat().map((r) => r.id);
  const bookings = slotIds.length
    ? await conn('slot_bookings')
        .leftJoin('users', 'slot_bookings.user_id', 'users.id')
        .whereIn('slot_bookings.slot_id', slotIds)
        .select(
          'slot_bookings.id as id',
          'slot_bookings.slot_id as slot_id',
          'slot_bookings.user_id as user_id',
          'slot_bookings.status as status',
          'users.email as email',
          'users.name as name',
        )
    : [];

  const bookingsBySlot = new Map<string, any[]>();
  for (const b of bookings) {
    const key = String(b.slot_id);
    if (!bookingsBySlot.has(key)) bookingsBySlot.set(key, []);
    bookingsBySlot.get(key)!.push(b);
  }

  return [...rowsByIdentity.entries()].map(([identity, rows]) => ({
    identity,
    description: describeSlot(rows[0]),
    rows: rows.map((row) => {
      const mine = bookingsBySlot.get(String(row.id)) || [];
      const confirmed = mine.filter((b) => b.status === 'confirmed');
      return {
        id: row.id,
        capacity: Number(row.capacity || 0),
        bookingOpen: Boolean(row.booking_is_open),
        confirmedBookings: confirmed.length,
        otherBookings: mine.length - confirmed.length,
        bookedBy: confirmed.map((b) => b.email || b.name || b.user_id),
        createdAt: row.created_at || null,
      };
    }),
  }));
}

// GET /api/admin/duplicate-slots - read-only. Shows exactly what is duplicated
// and who would be affected by merging it.
router.get('/duplicate-slots', authenticate, authorize(['superadmin']), async (_req, res) => {
  try {
    const groups = await findDuplicateGroups(db);
    res.json({
      groupCount: groups.length,
      totalRows: groups.reduce((n, g) => n + g.rows.length, 0),
      indexIsUnique: groups.length === 0,
      groups,
    });
  } catch (err: any) {
    console.error('Duplicate slots lookup failed:', err);
    captureError('admin: Duplicate slots lookup failed:', err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// POST /api/admin/merge-duplicate-slots
// Dry run by default; pass { "apply": true } to actually write.
router.post('/merge-duplicate-slots', authenticate, authorize(['superadmin']), async (req: any, res) => {
  const apply = req.body?.apply === true;

  try {
    const plan: any[] = [];

    const run = async (conn: any) => {
      const groups = await findDuplicateGroups(conn);

      for (const group of groups) {
        // The survivor is the row carrying the most confirmed bookings, so
        // the fewest bookings have to be moved and the smallest number of
        // people are touched at all. Ties break on the oldest row, then on
        // id, purely so the choice is deterministic and re-runnable.
        const ordered = [...group.rows].sort((a, b) => {
          if (b.confirmedBookings !== a.confirmedBookings) return b.confirmedBookings - a.confirmedBookings;
          const at = a.createdAt ? new Date(a.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bt = b.createdAt ? new Date(b.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
          if (at !== bt) return at - bt;
          return String(a.id).localeCompare(String(b.id));
        });

        const survivor = ordered[0];
        const losers = ordered.slice(1);
        // Nobody should lose a seat because two half-full copies became one.
        const capacity = Math.max(...group.rows.map((r) => r.capacity));

        const actions = {
          identity: group.identity,
          description: group.description,
          keep: survivor.id,
          remove: losers.map((l) => l.id),
          capacity,
          bookingsMoved: 0,
          duplicateBookingsDropped: [] as string[],
          tradesRepointed: 0,
          degenerateTradesClosed: 0,
        };

        for (const loser of losers) {
          const loserBookings = await conn('slot_bookings').where({ slot_id: loser.id });

          for (const booking of loserBookings) {
            const clash = await conn('slot_bookings')
              .where({ slot_id: survivor.id, user_id: booking.user_id })
              .first();

            if (clash) {
              // slot_bookings carries UNIQUE(slot_id, user_id), so this
              // person cannot simply be moved across - they are already on
              // the survivor. Keep whichever row is confirmed and drop the
              // other, rather than failing the whole merge.
              if (apply) {
                if (booking.status === 'confirmed' && clash.status !== 'confirmed') {
                  await conn('slot_bookings').where({ id: clash.id }).update({ status: 'confirmed' });
                }
                await conn('slot_bookings').where({ id: booking.id }).del();
              }
              actions.duplicateBookingsDropped.push(String(booking.user_id));
            } else {
              if (apply) {
                await conn('slot_bookings').where({ id: booking.id }).update({ slot_id: survivor.id });
              }
              actions.bookingsMoved += 1;
            }
          }

          // A trade pointing at a row about to disappear would be orphaned.
          const senderTrades = await conn('trade_requests').where({ sender_slot_id: loser.id });
          const receiverTrades = await conn('trade_requests').where({ receiver_slot_id: loser.id });
          actions.tradesRepointed += senderTrades.length + receiverTrades.length;
          if (apply) {
            await conn('trade_requests').where({ sender_slot_id: loser.id }).update({ sender_slot_id: survivor.id });
            await conn('trade_requests').where({ receiver_slot_id: loser.id }).update({ receiver_slot_id: survivor.id });
            await conn('work_slots').where({ id: loser.id }).del();
          }
        }

        // Repointing can collapse both sides of a trade onto the same shift.
        // A pending "swap my shift for your shift" where both shifts are now
        // one row is not a trade anyone can act on - accepting it would move
        // a booking onto the slot it is already on. It was already meaningless
        // before the merge (the two rows were the same shift all along); the
        // merge only makes that visible, so close it rather than leave a
        // request nobody can answer.
        //
        // Detected from the group's ids, NOT from sender_slot_id ===
        // receiver_slot_id after repointing: in a dry run no repointing has
        // happened, so that test matches nothing and the preview would
        // under-report to zero - telling the operator this endpoint does
        // something it does not.
        const groupIds = group.rows.map((r) => r.id);
        const degenerate = await conn('trade_requests')
          .where({ status: 'pending' })
          .whereIn('sender_slot_id', groupIds)
          .whereIn('receiver_slot_id', groupIds);
        actions.degenerateTradesClosed = degenerate.length;
        if (apply && degenerate.length > 0) {
          // 'rejected', not 'cancelled': trade_requests.status is an enum of
          // pending/accepted/approved/rejected, and a CHECK constraint
          // violation here would abort the entire merge transaction.
          await conn('trade_requests')
            .whereIn('id', degenerate.map((t: any) => t.id))
            .update({ status: 'rejected' });
        }

        if (apply) {
          await conn('work_slots').where({ id: survivor.id }).update({ capacity, updated_at: conn.fn.now() });
        }

        plan.push(actions);
      }
    };

    if (apply) {
      // All groups in one transaction: a partial merge would leave the data
      // in a state neither this endpoint nor a human could reason about.
      await db.transaction(run);
    } else {
      await run(db);
    }

    let indexPromoted = false;
    let indexError: string | null = null;
    if (apply && plan.length > 0) {
      const remaining = await findDuplicateGroups(db);
      if (remaining.length === 0) {
        // Now that the table is clean, the index the migration had to leave
        // non-unique can finally do its job.
        try {
          await db.schema.alterTable('work_slots', (table) => {
            table.dropIndex(SLOT_IDENTITY_COLUMNS as unknown as string[], SLOT_NONUNIQUE_INDEX);
          });
        } catch {
          // Already gone, or never created under that name. Not fatal.
        }
        try {
          await db.schema.alterTable('work_slots', (table) => {
            table.unique(SLOT_IDENTITY_COLUMNS as unknown as string[], { indexName: SLOT_UNIQUE_INDEX });
          });
          indexPromoted = true;
        } catch (err: any) {
          indexError = String(err?.message || err);
        }
      }
    }

    if (apply) {
      await logAction(
        req.user?.id,
        'MERGE_DUPLICATE_SLOTS',
        'work_slots',
        null,
        `${plan.length} group(s) merged; ` +
        `${plan.reduce((n, p) => n + p.remove.length, 0)} row(s) removed; ` +
        `${plan.reduce((n, p) => n + p.bookingsMoved, 0)} booking(s) moved; ` +
        `${plan.reduce((n, p) => n + p.duplicateBookingsDropped.length, 0)} duplicate booking(s) dropped; ` +
        `${plan.reduce((n, p) => n + p.degenerateTradesClosed, 0)} self-referencing trade(s) rejected; ` +
        `unique index promoted: ${indexPromoted}`,
        req,
      );
    }

    res.json({
      applied: apply,
      groupCount: plan.length,
      plan,
      indexPromoted,
      indexError,
      message: apply
        ? `${plan.length} бүлэг нэгтгэгдлээ.`
        : `Туршилтын горим - юу ч өөрчлөгдөөгүй. Бодитоор хийхийг хүсвэл { "apply": true } илгээнэ үү.`,
    });
  } catch (err: any) {
    console.error('Merge duplicate slots failed:', err);
    captureError('admin: Merge duplicate slots failed:', err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

export default router;
