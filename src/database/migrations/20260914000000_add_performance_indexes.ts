import type { Knex } from 'knex';
import { columnExists, tableExists } from '../schemaUtils';

// Adds the indexes the hot read paths have been missing.
//
// SQL Server does NOT create an index for a foreign key automatically (only
// for a PRIMARY KEY / UNIQUE constraint), so columns like
// `slot_bookings.slot_id` had no index at all despite being the single most
// queried column in the app. Every capacity check ("how many people have
// booked this slot?"), every "my bookings" lookup and every audit-log page
// was therefore a full table scan. That is invisible with a handful of rows
// and quietly catastrophic during a booking rush, where the same scans run
// hundreds of times per second while rows are also being inserted.
//
// Every index below is created defensively: the table/column is checked
// first, and a duplicate-index error is swallowed, so this migration is safe
// to run against a database where some of them already exist.

interface IndexSpec {
  table: string;
  columns: string[];
  name: string;
  reason: string;
}

const INDEXES: IndexSpec[] = [
  {
    table: 'slot_bookings',
    columns: ['slot_id', 'status'],
    name: 'idx_slot_bookings_slot_status',
    reason: 'capacity count per slot, on every single booking attempt',
  },
  {
    table: 'slot_bookings',
    columns: ['user_id', 'status'],
    name: 'idx_slot_bookings_user_status',
    reason: "a CSR's own bookings and the same-day / weekly-limit checks",
  },
  {
    table: 'audit_logs',
    columns: ['created_at'],
    name: 'idx_audit_logs_created_at',
    reason: 'the superadmin log view and the periodic 3-month cleanup delete',
  },
  {
    table: 'audit_logs',
    columns: ['user_id'],
    name: 'idx_audit_logs_user_id',
    reason: 'filtering the audit log by user',
  },
  {
    table: 'leave_requests',
    columns: ['user_id'],
    name: 'idx_leave_requests_user_id',
    reason: "a CSR's own leave requests, polled by the dashboard",
  },
  {
    table: 'vacation_requests',
    columns: ['user_id'],
    name: 'idx_vacation_requests_user_id',
    reason: "a CSR's own vacation requests, polled by the dashboard",
  },
  {
    table: 'trade_requests',
    columns: ['sender_id'],
    name: 'idx_trade_requests_sender_id',
    reason: 'trade lists, polled by every CSR dashboard',
  },
  {
    table: 'trade_requests',
    columns: ['receiver_id'],
    name: 'idx_trade_requests_receiver_id',
    reason: 'trade lists, polled by every CSR dashboard',
  },
  {
    table: 'trade_requests',
    columns: ['status'],
    name: 'idx_trade_requests_status',
    reason: 'the pending-trade expiry sweep',
  },
  {
    table: 'notifications',
    columns: ['target_user_id'],
    name: 'idx_notifications_target_user_id',
    reason: 'per-user notification fetch, polled by every dashboard',
  },
  {
    table: 'notifications',
    columns: ['created_at'],
    name: 'idx_notifications_created_at',
    reason: 'newest-first ordering and the 3-month purge delete',
  },
  {
    table: 'notification_read_receipts',
    columns: ['user_id'],
    name: 'idx_notification_read_receipts_user_id',
    reason: 'joining read state onto the notification list',
  },
  {
    table: 'notification_read_receipts',
    columns: ['notification_id'],
    name: 'idx_notification_read_receipts_notification_id',
    reason: 'bulk read-receipt lookup for the admin notification list',
  },
];

function isDuplicateIndexError(err: any): boolean {
  const message = String(err?.message || err || '').toLowerCase();
  return (
    message.includes('already exists') ||
    message.includes('already an index') ||
    message.includes('duplicate')
  );
}

async function specApplies(knex: Knex, spec: IndexSpec): Promise<boolean> {
  if (!(await tableExists(knex, spec.table))) return false;
  for (const column of spec.columns) {
    if (!(await columnExists(knex, spec.table, column))) return false;
  }
  return true;
}

export async function up(knex: Knex): Promise<void> {
  for (const spec of INDEXES) {
    if (!(await specApplies(knex, spec))) {
      console.log(`Skipping index ${spec.name}: table/column not present`);
      continue;
    }

    try {
      await knex.schema.alterTable(spec.table, (table) => {
        table.index(spec.columns, spec.name);
      });
      console.log(`Created index ${spec.name} (${spec.reason})`);
    } catch (err: any) {
      if (isDuplicateIndexError(err)) {
        console.log(`Index ${spec.name} already exists, skipping`);
        continue;
      }
      throw err;
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const spec of [...INDEXES].reverse()) {
    if (!(await specApplies(knex, spec))) continue;
    try {
      await knex.schema.alterTable(spec.table, (table) => {
        table.dropIndex(spec.columns, spec.name);
      });
    } catch (err) {
      // An index that is not there is already in the desired state.
      console.log(`Could not drop index ${spec.name} (probably absent):`, (err as any)?.message || err);
    }
  }
}
