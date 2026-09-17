import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils';

// There was no way to invalidate a session. Tokens are self-contained JWTs
// with a 24h life, stored in localStorage; there is no jti, no blacklist and
// no refresh flow. `password_changed_at` was written on every password
// change and reset but NEVER compared against anything.
//
// The practical consequences: logging out left a fully valid token behind,
// changing your password did not end your other sessions, and an admin
// resetting a compromised account's password did not eject whoever was
// already inside it. Deleting the user was the only reliable revocation.
//
// `sessions_valid_from` is the cutoff the authenticate middleware compares a
// token's `iat` against. It is bumped when a password is changed or reset,
// and on an explicit "sign out everywhere". Keeping it separate from
// password_changed_at means the two can diverge - a forced sign-out does not
// have to pretend the password changed.
export async function up(knex: Knex): Promise<void> {
  const exists = await columnExists(knex, 'users', 'sessions_valid_from');
  if (exists) return;

  await knex.schema.alterTable('users', (table) => {
    table.dateTime('sessions_valid_from').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  const exists = await columnExists(knex, 'users', 'sessions_valid_from');
  if (!exists) return;

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('sessions_valid_from');
  });
}
