import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasLocation = await knex.schema.hasColumn('users', 'location');
  if (!hasLocation) {
    await knex.schema.alterTable('users', (table) => {
      table.string('location');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasLocation = await knex.schema.hasColumn('users', 'location');
  if (hasLocation) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('location');
    });
  }
}
