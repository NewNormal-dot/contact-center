import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasSetupHash = await knex.schema.hasColumn('users', 'password_setup_token_hash');
  const hasSetupExpires = await knex.schema.hasColumn('users', 'password_setup_expires_at');
  const hasInvitedAt = await knex.schema.hasColumn('users', 'invited_at');
  const hasInvitationSentAt = await knex.schema.hasColumn('users', 'invitation_sent_at');
  const hasPasswordChangedAt = await knex.schema.hasColumn('users', 'password_changed_at');

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

  await knex.schema.alterTable('users', (table) => {
    for (const column of columns) {
      table.dropColumn(column);
    }
  });
}
