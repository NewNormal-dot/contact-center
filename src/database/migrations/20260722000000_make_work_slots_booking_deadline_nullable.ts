import type { Knex } from 'knex';

// The initial schema created `work_slots.booking_deadline` as NOT NULL, but
// application logic (see resolveBookingWindow / POST /slots / /slots/sync-schedules
// in src/api/slots.ts) intentionally stores `booking_deadline = NULL` whenever a
// shift's booking window is closed. On Azure SQL (mssql) this NOT NULL
// constraint rejects that NULL write with a hard SQL error, which surfaces to
// admins as "Хуваарь DB-д хадгалахад алдаа гарлаа." when creating/editing a
// shift that has booking closed. This migration aligns the schema with the
// application's actual data model.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('work_slots', (table) => {
    table.dateTime('booking_deadline').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Not reverted automatically: rows with NULL booking_deadline would violate
  // a restored NOT NULL constraint. Backfill NULLs before reverting manually
  // if this ever needs to be rolled back.
}
