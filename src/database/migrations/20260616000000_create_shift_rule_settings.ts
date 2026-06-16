import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('shift_rule_settings');
  if (exists) return;

  await knex.schema.createTable('shift_rule_settings', (table) => {
    table.string('id', 191).primary();
    table.string('rule_type', 64).notNullable();
    table.string('month_key', 7).nullable();
    table.string('segment', 100).notNullable();
    table.string('employment_type', 20).notNullable();
    table.text('value_text').notNullable();
    table.timestamps(true, true);

    table.index(['rule_type', 'month_key', 'segment', 'employment_type'], 'idx_shift_rule_settings_lookup');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shift_rule_settings');
}
