import type { Knex } from 'knex';
import path from 'path';

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'better-sqlite3',
    connection: {
      filename: path.join(process.cwd(), 'database.sqlite'),
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(process.cwd(), 'src/database/migrations'),
    },
    seeds: {
      directory: path.join(process.cwd(), 'src/database/seeds'),
    },
  },
  production: {
    client: process.env.DATABASE_URL ? 'pg' : 'better-sqlite3',
    connection: process.env.DATABASE_URL 
      ? {
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false } // Required for Azure PostgreSQL in many cases
        }
      : {
          filename: path.join(process.cwd(), 'database.sqlite'),
        },
    useNullAsDefault: !process.env.DATABASE_URL,
    migrations: {
      directory: path.join(process.cwd(), 'src/database/migrations'),
    },
    seeds: {
      directory: path.join(process.cwd(), 'src/database/seeds'),
    },
  },
};

export default config;
