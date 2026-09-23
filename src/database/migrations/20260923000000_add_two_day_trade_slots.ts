import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils.ts';

export async function up(knex: Knex): Promise<void> {
  if (!(await columnExists(knex, 'trade_requests', 'sender_next_slot_id'))) {
    await knex.schema.alterTable('trade_requests', (table) => {
      table.uuid('sender_next_slot_id').nullable().references('id').inTable('work_slots');
    });
  }
  if (!(await columnExists(knex, 'trade_requests', 'receiver_next_slot_id'))) {
    await knex.schema.alterTable('trade_requests', (table) => {
      table.uuid('receiver_next_slot_id').nullable().references('id').inTable('work_slots');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await columnExists(knex, 'trade_requests', 'receiver_next_slot_id')) {
    await knex.schema.alterTable('trade_requests', (table) => table.dropColumn('receiver_next_slot_id'));
  }
  if (await columnExists(knex, 'trade_requests', 'sender_next_slot_id')) {
    await knex.schema.alterTable('trade_requests', (table) => table.dropColumn('sender_next_slot_id'));
  }
}
