export function toSqlDate(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

export function toSqlTime(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [value.getHours(), value.getMinutes(), value.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampm) {
    let hour = Number(ampm[1]);
    const period = ampm[4].toUpperCase();
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${ampm[2]}:${ampm[3] || '00'}`;
  }

  const twentyFour = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (twentyFour) {
    const hour = Number(twentyFour[1]);
    const minute = Number(twentyFour[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${twentyFour[3] || '00'}`;
  }

  return null;
}

export function toSqlDateTime(value: unknown, fallback?: Date | null): Date | null {
  if (!value) return fallback ?? null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const raw = String(value).trim();
  if (!raw) return fallback ?? null;

  const isoLocal = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (isoLocal) {
    return new Date(
      Number(isoLocal[1]),
      Number(isoLocal[2]) - 1,
      Number(isoLocal[3]),
      Number(isoLocal[4]),
      Number(isoLocal[5]),
      Number(isoLocal[6] || 0),
    );
  }

  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (us) {
    let hour = Number(us[4]);
    const period = us[7]?.toUpperCase();
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]), hour, Number(us[5]), Number(us[6] || 0));
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return fallback ?? null;
}

export function displayDate(value: unknown): string {
  return toSqlDate(value) || '';
}

export function displayTime(value: unknown): string {
  const time = toSqlTime(value);
  return time ? time.slice(0, 5) : '';
}

export function displayDateTime(value: unknown): string {
  const date = toSqlDateTime(value);
  return date ? date.toISOString() : '';
}
