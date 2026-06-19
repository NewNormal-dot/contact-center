import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils.ts';

export async function up(knex: Knex): Promise<void> {
  if (!(await columnExists(knex, 'work_slots', 'booking_open_at'))) {
    await knex.schema.alterTable('work_slots', (table) => {
      table.dateTime('booking_open_at').nullable();
    });
  }

  if (!(await columnExists(knex, 'work_slots', 'booking_is_open'))) {
    await knex.schema.alterTable('work_slots', (table) => {
      table.boolean('booking_is_open').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await columnExists(knex, 'work_slots', 'booking_is_open')) {
    await knex.schema.alterTable('work_slots', (table) => table.dropColumn('booking_is_open'));
  }

  if (await columnExists(knex, 'work_slots', 'booking_open_at')) {
    await knex.schema.alterTable('work_slots', (table) => table.dropColumn('booking_open_at'));
  }
}
