import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils.ts';

export async function up(knex: Knex): Promise<void> {
  if (!(await columnExists(knex, 'work_slots', 'segment'))) {
    await knex.schema.alterTable('work_slots', (table) => {
      table.string('segment').notNullable().defaultTo('All');
    });
  }
  if (!(await columnExists(knex, 'work_slots', 'employment_type'))) {
    await knex.schema.alterTable('work_slots', (table) => {
      table.string('employment_type').notNullable().defaultTo('Full Time');
    });
  }
  if (!(await columnExists(knex, 'work_slots', 'is_rest'))) {
    await knex.schema.alterTable('work_slots', (table) => {
      table.boolean('is_rest').notNullable().defaultTo(false);
    });
  }
  if (!(await columnExists(knex, 'trade_requests', 'receiver_responded_at'))) {
    await knex.schema.alterTable('trade_requests', (table) => {
      table.dateTime('receiver_responded_at').nullable();
    });
  }
  if (!(await columnExists(knex, 'trade_requests', 'admin_decided_at'))) {
    await knex.schema.alterTable('trade_requests', (table) => {
      table.dateTime('admin_decided_at').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await columnExists(knex, 'trade_requests', 'admin_decided_at')) {
    await knex.schema.alterTable('trade_requests', (table) => table.dropColumn('admin_decided_at'));
  }
  if (await columnExists(knex, 'trade_requests', 'receiver_responded_at')) {
    await knex.schema.alterTable('trade_requests', (table) => table.dropColumn('receiver_responded_at'));
  }
  if (await columnExists(knex, 'work_slots', 'is_rest')) {
    await knex.schema.alterTable('work_slots', (table) => table.dropColumn('is_rest'));
  }
  if (await columnExists(knex, 'work_slots', 'employment_type')) {
    await knex.schema.alterTable('work_slots', (table) => table.dropColumn('employment_type'));
  }
  if (await columnExists(knex, 'work_slots', 'segment')) {
    await knex.schema.alterTable('work_slots', (table) => table.dropColumn('segment'));
  }
}
