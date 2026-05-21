import type { Knex } from 'knex';
import path from 'path';
import dotenv from 'dotenv';
import { TYPES } from 'tedious';

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

const mssqlOptions = {
  encrypt: true,
  trustServerCertificate: false,
  enableArithAbort: true,
  mapBinding: (value: unknown) => {
    if (typeof value === 'string') return { type: TYPES.NVarChar, value };
    if (typeof value === 'number') {
      return { type: Number.isInteger(value) ? TYPES.Int : TYPES.Float, value };
    }
    if (typeof value === 'boolean') return { type: TYPES.Bit, value };
    if (value instanceof Date) return { type: TYPES.DateTime2, value };
    return undefined;
  },
};

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
    connection: {
      server: requireEnv('DB_SERVER'),
      database: requireEnv('DB_NAME'),
      user: requireEnv('DB_USER'),
      password: requireEnv('DB_PASSWORD'),
      port: Number(process.env.DB_PORT || 1433),
      options: mssqlOptions as any,
    } as any,
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
