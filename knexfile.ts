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
      // min: 1 keeps at least one connection to Azure SQL alive at all
      // times, established when the server starts (not on the first
      // incoming request). Previously min: 0 meant the very first request
      // after a deploy/restart had to pay the full cost of a fresh TCP+TLS
      // handshake to Azure SQL, which could be slow enough to fail/timeout
      // while later requests (reusing the now-open connection) succeeded
      // instantly - matching the "fails once, then works after refresh"
      // symptom.
      min: 1,
      max: 10,
    },
  },
};

export default config;
