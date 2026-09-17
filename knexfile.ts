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
      // SQLITE_FILE lets the test suite point at a throwaway database
      // instead of the developer's working one.
      filename: process.env.SQLITE_FILE || path.join(process.cwd(), 'database.sqlite'),
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
      // How long a single statement may run before the driver gives up.
      // Without this the driver's default (15s) applies to every query,
      // which is too tight for the occasional heavy admin report but far
      // too loose for the hot per-request queries - a stuck query would
      // otherwise hold one of the few pool connections hostage while 200
      // users queue behind it. 30s is a deliberate middle ground.
      requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS || 30000),
      // Establishing a brand-new TCP+TLS connection to Azure SQL is much
      // slower than reusing one, especially when many are opened at once
      // during a booking rush.
      connectionTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 30000),
      options: {
        encrypt: true,
        trustServerCertificate: false,
        // The app always does its own explicit UTC math (see
        // src/utils/sqlDate.ts) when converting the admin's local
        // (Mongolia, UTC+8) wall-clock input to/from DATETIME columns,
        // which have no timezone concept in SQL Server. Setting this
        // explicitly removes any ambiguity in how the driver itself
        // interprets/serializes those naive values, so a booking-open
        // time round-trips back as the exact same instant it was saved as.
        useUTC: true,
      },
    }),
    migrations: {
      directory: migrationDir,
    },
    seeds: {
      directory: seedDir,
    },
    pool: {
      // min keeps this many connections to Azure SQL alive at all times,
      // established when the server starts (not on the first incoming
      // request). Previously min: 0 meant the very first request after a
      // deploy/restart had to pay the full cost of a fresh TCP+TLS
      // handshake to Azure SQL, which could be slow enough to fail/timeout
      // while later requests (reusing the now-open connection) succeeded
      // instantly - matching the "fails once, then works after refresh"
      // symptom.
      min: Number(process.env.DB_POOL_MIN || 2),
      // max is the single most important concurrency knob here: it caps how
      // many queries this instance can have in flight at once. Everything
      // beyond it queues. 10 was too tight for a booking-rush burst (a few
      // hundred concurrent CSRs), so the default is raised to 20 - still
      // comfortably inside what a Standard S0 Azure SQL database allows
      // (S0 permits ~60 concurrent workers / 600 sessions), leaving room
      // for a second/third App Service instance during a scale-out.
      max: Number(process.env.DB_POOL_MAX || 20),
      // Fail fast instead of hanging. knex's default acquire timeout is 60s,
      // which means that during a burst a request could sit waiting for a
      // free connection for a full minute - long past the point the user
      // gave up and hit refresh (creating yet another queued request, making
      // the pile-up worse). 15s surfaces a real error while the pool is
      // still recoverable.
      acquireTimeoutMillis: Number(process.env.DB_POOL_ACQUIRE_TIMEOUT_MS || 15000),
      createTimeoutMillis: Number(process.env.DB_POOL_CREATE_TIMEOUT_MS || 30000),
      // Azure SQL (and the load balancer in front of it) silently drops
      // connections that have been idle for a few minutes. Recycling them
      // on our side first avoids handing a dead socket to a real request.
      idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS || 60000),
      reapIntervalMillis: 10000,
      propagateCreateError: false,
    },
    // Azure SQL routinely returns short-lived "transient" errors during
    // failover/throttling. Retrying the connection attempt a few times is
    // the documented way to ride those out instead of surfacing them.
    acquireConnectionTimeout: Number(process.env.DB_ACQUIRE_CONNECTION_TIMEOUT_MS || 20000),
  },
};

export default config;
