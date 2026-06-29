import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils.ts';

export async function up(knex: Knex): Promise<void> {
  const hasSetupHash = await columnExists(knex, 'users', 'password_setup_token_hash');
  const hasSetupExpires = await columnExists(knex, 'users', 'password_setup_expires_at');
  const hasInvitedAt = await columnExists(knex, 'users', 'invited_at');
  const hasInvitationSentAt = await columnExists(knex, 'users', 'invitation_sent_at');
  const hasPasswordChangedAt = await columnExists(knex, 'users', 'password_changed_at');

  await knex.schema.alterTable('users', (table) => {
    if (!hasSetupHash) table.string('password_setup_token_hash', 128).nullable().index();
    if (!hasSetupExpires) table.dateTime('password_setup_expires_at').nullable();
    if (!hasInvitedAt) table.dateTime('invited_at').nullable();
    if (!hasInvitationSentAt) table.dateTime('invitation_sent_at').nullable();
    if (!hasPasswordChangedAt) table.dateTime('password_changed_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  const columns = [
    'password_setup_token_hash',
    'password_setup_expires_at',
    'invited_at',
    'invitation_sent_at',
    'password_changed_at',
  ];

  const existingColumns = [];
  for (const column of columns) {
    if (await columnExists(knex, 'users', column)) {
      existingColumns.push(column);
    }
  }

  if (existingColumns.length === 0) return;

  await knex.schema.alterTable('users', (table) => {
    for (const column of existingColumns) table.dropColumn(column);
  });
}
