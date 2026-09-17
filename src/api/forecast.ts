import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { tableExists } from '../database/schemaUtils';
import { authenticate, authorize } from '../middleware/auth';
import { captureError } from '../utils/errorLog';

const router = express.Router();

type ForecastInputRow = {
  date?: string;
  dateTime?: string;
  date_time?: string;
  segment?: string;
  forecast?: number | string;
  hr?: number | string;
};

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthKeyFromDate(date: Date) {
  const local = toMongoliaParts(date);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Mongolia is UTC+8 with no DST. Azure App Service runs in UTC, so reading
// the calendar fields off a Date with getFullYear()/getHours() gave the UTC
// wall clock, not the Mongolian one - an 09:00 reading was stored as 01:00.
// Everything here is expressed in Mongolian local time, consistently, in
// both directions.
const ULAANBAATAR_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function toMongoliaParts(date: Date) {
  return new Date(date.getTime() + ULAANBAATAR_UTC_OFFSET_MS);
}

function toDbDateTime(date: Date) {
  const local = toMongoliaParts(date);
  const yyyy = local.getUTCFullYear();
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mi = String(local.getUTCMinutes()).padStart(2, '0');
  const ss = String(local.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// Rows are stored as a NAIVE Mongolian wall clock ("2026-09-01 09:00:00").
// Returning them as an ISO instant requires subtracting the offset back off,
// otherwise the client re-reads 09:00 Mongolia as 09:00 UTC.
function toIsoDateTime(value: unknown) {
  if (!value) return '';

  // The mssql driver (useUTC: true) hands back a Date whose UTC fields ARE
  // the stored wall clock; sqlite hands back the raw string.
  const naive = value instanceof Date
    ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}` +
      `T${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}:${String(value.getUTCSeconds()).padStart(2, '0')}`
    : String(value).trim().replace(' ', 'T');

  const match = naive.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    const parsed = new Date(naive);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
  }

  const asIfUtc = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0),
  );
  return new Date(asIfUtc - ULAANBAATAR_UTC_OFFSET_MS).toISOString();
}

async function ensureForecastTable() {
  const exists = await tableExists(db, 'forecast_data');

  if (exists) return;

  await db.schema.createTable('forecast_data', (table) => {
    table.string('id').primary();
    table.dateTime('date_time').notNullable();
    table.string('month_key', 7).notNullable();
    table.string('segment').notNullable();
    table.integer('forecast').notNullable().defaultTo(0);
    table.integer('hr').notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(db.fn.now());
    table.timestamp('updated_at').defaultTo(db.fn.now());
    table.index(['month_key', 'segment']);
    table.index(['date_time']);
  });
}

function mapForecastRow(row: any) {
  return {
    id: row.id,
    date: toIsoDateTime(row.date_time),
    dateTime: toIsoDateTime(row.date_time),
    segment: row.segment,
    forecast: Number(row.forecast || 0),
    hr: Number(row.hr || 0),
    monthKey: row.month_key,
  };
}

// Contact-volume and headcount planning for the whole company. This was
// authenticate-only, so any CSR with a token could read it even though the
// UI never shows it to them.
router.get('/', authenticate, authorize(['admin', 'superadmin']), async (_req, res) => {
  try {
    await ensureForecastTable();
    const rows = await db('forecast_data')
      .select('*')
      .orderBy('date_time', 'asc')
      .orderBy('segment', 'asc');
    res.json(rows.map(mapForecastRow));
  } catch (err) {
    console.error('Get forecast error:', err);
    captureError('forecast: Get forecast error:', err);
    res.status(500).json({ error: 'Forecast дата татахад алдаа гарлаа' });
  }
});

router.post('/upload', authenticate, authorize(['superadmin', 'admin']), async (req: any, res) => {
  try {
    await ensureForecastTable();
    const inputRows: ForecastInputRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];

    const parsedRows = inputRows.map((row) => {
      const date = parseDate(row.date ?? row.dateTime ?? row.date_time);
      if (!date) return null;
      const segment = String(row.segment || 'Unknown').trim() || 'Unknown';
      return {
        id: uuidv4(),
        date_time: toDbDateTime(date),
        month_key: monthKeyFromDate(date),
        segment,
        forecast: Math.round(toNumber(row.forecast)),
        hr: Math.round(toNumber(row.hr)),
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      };
    }).filter(Boolean) as Array<Record<string, any>>;

    if (!parsedRows.length) {
      return res.status(400).json({ error: 'Хадгалах forecast дата олдсонгүй' });
    }

    const replacePairs = Array.from(new Set(parsedRows.map(row => `${row.month_key}|||${row.segment}`)))
      .map(value => {
        const [monthKey, segment] = value.split('|||');
        return { monthKey, segment };
      });

    await db.transaction(async (trx) => {
      for (const pair of replacePairs) {
        await trx('forecast_data')
          .where({ month_key: pair.monthKey, segment: pair.segment })
          .delete();
      }

      const chunkSize = 200;
      for (let index = 0; index < parsedRows.length; index += chunkSize) {
        await trx('forecast_data').insert(parsedRows.slice(index, index + chunkSize));
      }
    });

    const rows = await db('forecast_data')
      .select('*')
      .orderBy('date_time', 'asc')
      .orderBy('segment', 'asc');

    res.json({
      saved: parsedRows.length,
      replaced: replacePairs,
      rows: rows.map(mapForecastRow),
    });
  } catch (err) {
    console.error('Upload forecast error:', err);
    captureError('forecast: Upload forecast error:', err);
    res.status(500).json({ error: 'Forecast дата хадгалахад алдаа гарлаа' });
  }
});

export default router;
