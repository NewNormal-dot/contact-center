import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils';

export async function up(knex: Knex): Promise<void> {
  const hasSupervisorName = await columnExists(knex, 'users', 'supervisor_name');
  if (!hasSupervisorName) {
    await knex.schema.alterTable('users', (table) => {
      table.string('supervisor_name');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasSupervisorName = await columnExists(knex, 'users', 'supervisor_name');
  if (hasSupervisorName) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('supervisor_name');
    });
  }
}
