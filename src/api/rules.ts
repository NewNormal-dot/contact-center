import express from 'express';
import db from '../database/db';
import { authenticate, authorize } from '../middleware/auth';

const router = express.Router();

const VALID_RULE_TYPES = new Set(['monthly_font_hours', 'weekly_shift_rules']);

type WeeklyShiftRule = {
  totalHours: number;
  sixHourShifts: number;
  sevenHourShifts: number;
  restDays: number;
};

const DEFAULT_WEEKLY_SHIFT_RULE: WeeklyShiftRule = {
  totalHours: 40,
  sixHourShifts: 3,
  sevenHourShifts: 3,
  restDays: 1,
};

function makeSegmentTypeKey(segment: string, employmentType: string) {
  return `${segment || 'All'}|${employmentType || 'Full Time'}`;
}

function makeMonthlyFontHourKey(monthKey: string, segment: string, employmentType: string) {
  return `${monthKey}|${makeSegmentTypeKey(segment, employmentType)}`;
}

function makeRuleId(ruleType: string, monthKey: string | null, segment: string, employmentType: string) {
  return [ruleType, monthKey || 'ALL_MONTHS', segment || 'All', employmentType || 'Full Time']
    .map((part) => String(part).trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '_'))
    .join('__')
    .slice(0, 191);
}

function normalizeSegment(value: unknown) {
  return String(value || 'All').trim() || 'All';
}

function normalizeEmploymentType(value: unknown) {
  const raw = String(value || 'Full Time').trim();
  return raw === 'Part Time' ? 'Part Time' : 'Full Time';
}

function normalizeMonthKey(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  return /^\d{4}-\d{2}$/.test(raw) ? raw : null;
}

function normalizeMonthlyFontHours(value: unknown) {
  return Math.max(0, Math.min(744, Number(value) || 0));
}

function normalizeWeeklyShiftRule(value: any): WeeklyShiftRule {
  return {
    totalHours: Math.max(0, Math.min(168, Number(value?.totalHours ?? DEFAULT_WEEKLY_SHIFT_RULE.totalHours) || 0)),
    sixHourShifts: Math.max(0, Math.min(7, Number(value?.sixHourShifts ?? DEFAULT_WEEKLY_SHIFT_RULE.sixHourShifts) || 0)),
    sevenHourShifts: Math.max(0, Math.min(7, Number(value?.sevenHourShifts ?? DEFAULT_WEEKLY_SHIFT_RULE.sevenHourShifts) || 0)),
    restDays: Math.max(0, Math.min(7, Number(value?.restDays ?? DEFAULT_WEEKLY_SHIFT_RULE.restDays) || 0)),
  };
}

async function upsertRule(ruleType: string, monthKey: string | null, segment: string, employmentType: string, value: unknown) {
  if (!VALID_RULE_TYPES.has(ruleType)) throw new Error('Invalid rule type');

  const id = makeRuleId(ruleType, monthKey, segment, employmentType);
  const payload = {
    id,
    rule_type: ruleType,
    month_key: monthKey,
    segment,
    employment_type: employmentType,
    value_text: JSON.stringify(value),
    updated_at: db.fn.now(),
  };

  const existing = await db('shift_rule_settings').where({ id }).first();
  if (existing) {
    await db('shift_rule_settings').where({ id }).update(payload);
  } else {
    await db('shift_rule_settings').insert({ ...payload, created_at: db.fn.now() });
  }
}

function parseRuleValue(row: any) {
  try {
    return JSON.parse(row.value_text);
  } catch {
    return row.value_text;
  }
}

router.get('/', authenticate, async (_req, res) => {
  try {
    const rows = await db('shift_rule_settings').select('*');
    const monthlyFontHourRules: Record<string, number> = {};
    const weeklyShiftRules: Record<string, WeeklyShiftRule> = {};

    rows.forEach((row: any) => {
      const segment = normalizeSegment(row.segment);
      const employmentType = normalizeEmploymentType(row.employment_type);
      const value = parseRuleValue(row);

      if (row.rule_type === 'monthly_font_hours' && row.month_key) {
        monthlyFontHourRules[makeMonthlyFontHourKey(row.month_key, segment, employmentType)] = normalizeMonthlyFontHours(value);
      }

      if (row.rule_type === 'weekly_shift_rules') {
        weeklyShiftRules[makeSegmentTypeKey(segment, employmentType)] = normalizeWeeklyShiftRule(value);
      }
    });

    res.json({ monthlyFontHourRules, weeklyShiftRules });
  } catch (err) {
    console.error('Get shift rules error:', err);
    res.status(500).json({ error: 'Дүрмийн тохиргоо татахад алдаа гарлаа' });
  }
});

router.put('/monthly-font-hours', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
  try {
    const monthKey = normalizeMonthKey(req.body.monthKey);
    if (!monthKey) return res.status(400).json({ error: 'Сар YYYY-MM форматтай байх ёстой' });

    const segment = normalizeSegment(req.body.segment);
    const employmentType = normalizeEmploymentType(req.body.employmentType ?? req.body.employment_type);
    const hours = normalizeMonthlyFontHours(req.body.hours);

    await upsertRule('monthly_font_hours', monthKey, segment, employmentType, hours);
    res.json({ key: makeMonthlyFontHourKey(monthKey, segment, employmentType), hours });
  } catch (err) {
    console.error('Save monthly font hours error:', err);
    res.status(500).json({ error: 'Сарын фонт цаг хадгалахад алдаа гарлаа' });
  }
});

router.put('/weekly-shift-rules', authenticate, authorize(['admin', 'superadmin']), async (req, res) => {
  try {
    const segment = normalizeSegment(req.body.segment);
    const employmentType = normalizeEmploymentType(req.body.employmentType ?? req.body.employment_type);
    const rule = normalizeWeeklyShiftRule(req.body.rule || req.body);

    await upsertRule('weekly_shift_rules', null, segment, employmentType, rule);
    res.json({ key: makeSegmentTypeKey(segment, employmentType), rule });
  } catch (err) {
    console.error('Save weekly shift rule error:', err);
    res.status(500).json({ error: '7 хоногийн дүрэм хадгалахад алдаа гарлаа' });
  }
});

export default router;
