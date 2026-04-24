import pkg, { type Knex } from 'knex';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export async function seed(knex: Knex): Promise<void> {
  // Deletes ALL existing entries
  await knex("users").del();

  const id = uuidv4();
  const hashedPassword = await bcrypt.hash('Admin@123', 10);

  // Inserts seed entries
  await knex("users").insert([
    { 
      id, 
      email: 'enkhtur.a@mobicom.mn', 
      password_hash: hashedPassword, 
      name: 'Enkhtur A.', 
      role: 'superadmin',
      status: 'active',
      employment_type: 'Full Time'
    }
  ]);
};
