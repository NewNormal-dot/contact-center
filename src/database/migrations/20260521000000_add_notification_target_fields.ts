import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils';

export async function up(knex: Knex): Promise<void> {
  const hasType = await columnExists(knex, 'notifications', 'type');
  if (!hasType) {
    await knex.schema.alterTable('notifications', (table) => {
      table.string('type').notNullable().defaultTo('general');
    });
  }

  const hasTargetUserId = await columnExists(knex, 'notifications', 'target_user_id');
  if (!hasTargetUserId) {
    await knex.schema.alterTable('notifications', (table) => {
      table.uuid('target_user_id').nullable();
    });
  }

  const hasRelatedEntityType = await columnExists(knex, 'notifications', 'related_entity_type');
  if (!hasRelatedEntityType) {
    await knex.schema.alterTable('notifications', (table) => {
      table.string('related_entity_type').nullable();
    });
  }

  const hasRelatedEntityId = await columnExists(knex, 'notifications', 'related_entity_id');
  if (!hasRelatedEntityId) {
    await knex.schema.alterTable('notifications', (table) => {
      table.string('related_entity_id').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasRelatedEntityId = await columnExists(knex, 'notifications', 'related_entity_id');
  if (hasRelatedEntityId) {
    await knex.schema.alterTable('notifications', (table) => {
      table.dropColumn('related_entity_id');
    });
  }

  const hasRelatedEntityType = await columnExists(knex, 'notifications', 'related_entity_type');
  if (hasRelatedEntityType) {
    await knex.schema.alterTable('notifications', (table) => {
      table.dropColumn('related_entity_type');
    });
  }

  const hasTargetUserId = await columnExists(knex, 'notifications', 'target_user_id');
  if (hasTargetUserId) {
    await knex.schema.alterTable('notifications', (table) => {
      table.dropColumn('target_user_id');
    });
  }

  const hasType = await columnExists(knex, 'notifications', 'type');
  if (hasType) {
    await knex.schema.alterTable('notifications', (table) => {
      table.dropColumn('type');
    });
  }
}
