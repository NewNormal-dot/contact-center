import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils';

// BUG FIX: src/api/requests.ts has referenced `leave_requests.slot_booking_id`
// since the "urgent shift-leave" feature was added (see POST /leave and the
// mapLeave() select in GET /leave) - it stores which confirmed slot_bookings
// row a shift-leave request was raised against, and is used to look up the
// booking, prevent duplicate requests for the same shift, and enforce the
// 8-hour notice window.
//
// However, no migration ever actually created this column. On environments
// where the column happened to already exist (e.g. a hand-patched dev DB)
// this went unnoticed, but on a clean Azure SQL database every single query
// that touches `leave_requests` (GET /api/requests/leave, POST
// /api/requests/leave) fails with "Invalid column name 'slot_booking_id'"
// (500 Internal Server Error) - which is why hourly/shift leave requests
// have been completely broken in production.
export async function up(knex: Knex): Promise<void> {
  const hasSlotBookingId = await columnExists(knex, 'leave_requests', 'slot_booking_id');

  if (!hasSlotBookingId) {
    await knex.schema.alterTable('leave_requests', (table) => {
      table.uuid('slot_booking_id').nullable().references('id').inTable('slot_bookings').onDelete('SET NULL');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasSlotBookingId = await columnExists(knex, 'leave_requests', 'slot_booking_id');
  if (!hasSlotBookingId) return;

  await knex.schema.alterTable('leave_requests', (table) => {
    table.dropForeign('slot_booking_id');
  });
  await knex.schema.alterTable('leave_requests', (table) => {
    table.dropColumn('slot_booking_id');
  });
}
