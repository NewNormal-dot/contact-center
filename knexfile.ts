import type { Knex } from 'knex';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const migrationDir = path.join(process.cwd(), 'src/database/migrations');
const seedDir = path.join(process.cwd(), 'src/database/seeds');

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'better-sqlite3',
    connection: {
      filename: path.join(process.cwd(), 'database.sqlite'),
    },
    useNullAsDefault: true,
    migrations: {
      directory: migrationDir,
    },
    seeds: {
      directory: seedDir,
    },
  },

  production: {
    client: 'mssql',
    connection: () => ({
      server: requireEnv('DB_SERVER'),
      database: requireEnv('DB_NAME'),
      user: requireEnv('DB_USER'),
      password: requireEnv('DB_PASSWORD'),
      port: Number(process.env.DB_PORT || 1433),
      options: {
        encrypt: true,
        trustServerCertificate: false,
      },
    }),
    migrations: {
      directory: migrationDir,
    },
    seeds: {
      directory: seedDir,
    },
    pool: {
      min: 0,
      max: 10,
    },
  },
};

export default config;
