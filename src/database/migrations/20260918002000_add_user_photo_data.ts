import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils';

// The profile-photo control did nothing at all. Sidebar.tsx and
// AdminDashboard.tsx wrote the chosen file into localStorage under the key
// `users` - which only SuperAdminDashboard ever writes, which AuthContext
// does not read for photoUrl, and which is empty for a CSR. There was no
// upload endpoint, and `users.photo_url` was never written by any code. So
// the file dialog opened, the user picked an image, and nothing happened:
// no change, no error.
//
// `photo_url` is nvarchar(255) and cannot hold an image, so this adds a text
// column for the payload. It is deliberately NOT returned by the user-list
// endpoints - only by a user's own profile - so the roster stays small.
// Uploads are downscaled client-side and capped server-side.
export async function up(knex: Knex): Promise<void> {
  const exists = await columnExists(knex, 'users', 'photo_data');
  if (exists) return;

  await knex.schema.alterTable('users', (table) => {
    table.text('photo_data').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  const exists = await columnExists(knex, 'users', 'photo_data');
  if (!exists) return;

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('photo_data');
  });
}
