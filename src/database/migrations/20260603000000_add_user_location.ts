import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils';

export async function up(knex: Knex): Promise<void> {
  const hasLocation = await columnExists(knex, 'users', 'location');
  if (!hasLocation) {
    await knex.schema.alterTable('users', (table) => {
      table.string('location');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasLocation = await columnExists(knex, 'users', 'location');
  if (hasLocation) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('location');
    });
  }
}
