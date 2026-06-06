export const SHIFT_DUPLICATE_ALERT_MESSAGE = 'Энэ цаг нэмэгдсэн байна. Нэг shift дээр 2 захиалга авах бол Квот (Slots)-ыг 2 болгож хадгална уу.';

export type ShiftLike = {
  id?: string;
  time?: string;
  segment?: string;
  employmentType?: string;
};

const toTwoDigitHour = (value: string) => {
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return '';
  return String(hour).padStart(2, '0');
};

export const normalizeShiftTime = (value?: string | null) => {
  if (!value) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  const separatedMatch = raw.match(/(\d{1,2})(?::\d{1,2})?\D+(\d{1,2})(?::\d{1,2})?/);
  if (separatedMatch) {
    const start = toTwoDigitHour(separatedMatch[1]);
    const end = toTwoDigitHour(separatedMatch[2]);
    return start && end ? `${start}-${end}` : '';
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4) {
    const start = toTwoDigitHour(digits.slice(0, 2));
    const end = toTwoDigitHour(digits.slice(2, 4));
    return start && end ? `${start}-${end}` : '';
  }

  return '';
};

export const sanitizeShiftTimeInput = (value: string) => {
  const normalized = normalizeShiftTime(value);
  if (normalized) return normalized;

  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
};

export const isValidShiftTime = (value?: string | null) => /^\d{2}-\d{2}$/.test(normalizeShiftTime(value));

export const getShiftStartMinutes = (time?: string | null) => {
  const normalized = normalizeShiftTime(time);
  const [start] = normalized.split('-');
  if (!start) return 9999;
  return Number(start) * 60;
};

export const getHoursForShiftTime = (time?: string | null) => {
  const normalized = normalizeShiftTime(time);
  const [start, end] = normalized.split('-').map(Number);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  let diff = end - start;
  if (diff < 0) diff += 24;
  return diff;
};

export const getShiftDuplicateKey = (shift: ShiftLike, includeContext = true) => {
  const time = normalizeShiftTime(shift.time);
  if (!time) return '';
  if (!includeContext) return time;
  return [shift.segment || 'All', shift.employmentType || 'Full Time', time].join('|').toLowerCase();
};

export const isDuplicateShiftTime = (
  shifts: ShiftLike[] = [],
  target: ShiftLike,
  options: { ignoreId?: string; includeContext?: boolean } = {},
) => {
  const targetKey = getShiftDuplicateKey(target, options.includeContext ?? true);
  if (!targetKey) return false;

  return shifts.some(shift => {
    if (options.ignoreId && String(shift.id) === String(options.ignoreId)) return false;
    return getShiftDuplicateKey(shift, options.includeContext ?? true) === targetKey;
  });
};

export const getShiftDuplicateIndexMap = (
  shifts: ShiftLike[] = [],
  includeContext = true,
) => {
  const seen = new Map<string, number>();
  const result = new Map<string, number>();

  shifts.forEach((shift, index) => {
    const key = getShiftDuplicateKey(shift, includeContext);
    if (!key) return;

    const nextIndex = seen.get(key) || 0;
    seen.set(key, nextIndex + 1);
    result.set(shift.id ? String(shift.id) : `__index_${index}`, nextIndex);
  });

  return result;
};
