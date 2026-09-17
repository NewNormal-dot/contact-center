import type { Knex } from 'knex';
import { tableExists } from '../schemaUtils';

// Training materials were never persisted at all: the admin/superadmin
// handlers wrote them to localStorage and nothing ever called
// POST /api/broadcasts/trainings, so CSRs read an always-empty list.
//
// Wiring those handlers up exposes a second problem. The upload controls
// base64-encode the whole file into `trainings.attachment_url`, which is
// nvarchar(255) - any real file blows past that and the insert fails with a
// truncation error. There is no blob storage in this deployment (multer is
// unused, nothing writes to disk), so the payload needs a home of its own.
//
// A separate table rather than a widened column, for three reasons:
//   * it is fetched ONLY when someone actually opens a material, so the
//     list endpoint every dashboard polls stays small;
//   * `tableExists()` gives the API a clean, cheap way to degrade - if this
//     migration has not been applied yet (production runs with
//     SKIP_DB_MIGRATIONS=true and applies them by hand), attachments are
//     refused with a clear message instead of 500-ing, and link-only
//     materials keep working;
//   * dropping it later costs nothing.
export async function up(knex: Knex): Promise<void> {
  const exists = await tableExists(knex, 'training_attachments');
  if (exists) return;

  await knex.schema.createTable('training_attachments', (table) => {
    table.uuid('training_id').primary().references('id').inTable('trainings').onDelete('CASCADE');
    // A data: URL (or any oversized link). `text` maps to nvarchar(max) on
    // Azure SQL, which is what a base64 payload needs.
    table.text('data').notNullable();
    table.string('name');
    table.string('content_type');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('training_attachments');
}
