import type { Knex } from 'knex';
import { tableExists } from '../schemaUtils';

// The only record of a server-side error was a 30-entry ring buffer in
// process memory (src/utils/errorLog.ts), cleared on every restart and every
// deploy. There is no Application Insights, no log shipping and no error
// table, and the App Service log stream is not retained by default.
//
// The practical consequence: a complaint from last week could not be
// investigated at all. That is the single biggest reason the defects this
// branch fixes went undiagnosed for so long - they never surfaced as a bug
// report with a cause attached, only as "it sometimes doesn't work".
//
// This gives errors somewhere durable to live. Writes are best-effort and
// fire-and-forget: recording an error must never turn into a second error.
export async function up(knex: Knex): Promise<void> {
  const exists = await tableExists(knex, 'server_errors');
  if (exists) return;

  await knex.schema.createTable('server_errors', (table) => {
    table.uuid('id').primary();
    table.string('context', 200).notNullable();
    table.text('message').notNullable();
    table.text('stack');
    table.timestamp('created_at').defaultTo(knex.fn.now()).index();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('server_errors');
}
