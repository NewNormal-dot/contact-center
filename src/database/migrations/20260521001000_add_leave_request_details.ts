import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils';

export async function up(knex: Knex): Promise<void> {
  const hasType = await columnExists(knex, 'leave_requests', 'type');
  if (!hasType) {
    await knex.schema.alterTable('leave_requests', (table) => {
      table.string('type').notNullable().defaultTo('hourly');
    });
  }

  const hasEndDate = await columnExists(knex, 'leave_requests', 'end_date');
  if (!hasEndDate) {
    await knex.schema.alterTable('leave_requests', (table) => {
      table.date('end_date').nullable();
    });
  }

  const hasComment = await columnExists(knex, 'leave_requests', 'comment');
  if (!hasComment) {
    await knex.schema.alterTable('leave_requests', (table) => {
      table.text('comment').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasComment = await columnExists(knex, 'leave_requests', 'comment');
  if (hasComment) {
    await knex.schema.alterTable('leave_requests', (table) => {
      table.dropColumn('comment');
    });
  }

  const hasEndDate = await columnExists(knex, 'leave_requests', 'end_date');
  if (hasEndDate) {
    await knex.schema.alterTable('leave_requests', (table) => {
      table.dropColumn('end_date');
    });
  }

  const hasType = await columnExists(knex, 'leave_requests', 'type');
  if (hasType) {
    await knex.schema.alterTable('leave_requests', (table) => {
      table.dropColumn('type');
    });
  }
}
