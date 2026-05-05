import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasSegment = await knex.schema.hasColumn('users', 'segment');
  if (!hasSegment) {
    await knex.schema.table('users', (table) => {
      table.string('segment');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasSegment = await knex.schema.hasColumn('users', 'segment');
  if (hasSegment) {
    await knex.schema.table('users', (table) => {
      table.dropColumn('segment');
    });
  }
}
