import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { tableExists } from '../database/schemaUtils';
import { authenticate, authorize } from '../middleware/auth';

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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function toDbDateTime(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function toIsoDateTime(value: unknown) {
  if (!value) return '';
  const raw = String(value);
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
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

router.get('/', authenticate, async (_req, res) => {
  try {
    await ensureForecastTable();
    const rows = await db('forecast_data')
      .select('*')
      .orderBy('date_time', 'asc')
      .orderBy('segment', 'asc');
    res.json(rows.map(mapForecastRow));
  } catch (err) {
    console.error('Get forecast error:', err);
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
    res.status(500).json({ error: 'Forecast дата хадгалахад алдаа гарлаа' });
  }
});

export default router;
