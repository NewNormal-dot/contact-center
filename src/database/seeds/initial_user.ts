import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export async function seed(knex: Knex): Promise<void> {
  await knex('users').del();

  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;

  if (!email || !password || password.length < 10) {
    throw new Error('SEED_SUPERADMIN_EMAIL болон хамгийн багадаа 10 тэмдэгттэй SEED_SUPERADMIN_PASSWORD тохируулна уу');
  }

  const id = uuidv4();
  const hashedPassword = await bcrypt.hash(password, 10);

  await knex('users').insert([
    {
      id,
      email,
      password_hash: hashedPassword,
      name: 'Enkhtur A.',
      role: 'superadmin',
      status: 'active',
      employment_type: 'Full Time',
    },
  ]);
}
