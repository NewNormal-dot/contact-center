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

// Mongolia does not observe DST, so this fixed offset is always correct.
const ULAANBAATAR_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

export function toSqlDateTime(value: unknown, fallback?: Date | null): Date | null {
  if (!value) return fallback ?? null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const raw = String(value).trim();
  if (!raw) return fallback ?? null;

  // If the string already carries explicit timezone info (a trailing 'Z'
  // for UTC, or a '+HH:MM'/'-HH:MM' offset), it's an unambiguous instant in
  // time - hand it directly to the standard parser, which correctly
  // resolves it regardless of what timezone THIS server process runs in.
  const hasExplicitTimezone = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (hasExplicitTimezone) {
    const parsedWithTz = new Date(raw);
    if (!Number.isNaN(parsedWithTz.getTime())) return parsedWithTz;
  }

  // HTML <input type="datetime-local"> (used by the admin's schedule/
  // booking-window pickers) always produces "YYYY-MM-DDTHH:mm" - exactly
  // this format, NEVER with seconds. That's the only case where the raw
  // string genuinely represents a fresh, un-adjusted Mongolia wall-clock
  // time that needs the UTC offset applied.
  const isoLocalNoSeconds = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (isoLocalNoSeconds && !hasExplicitTimezone) {
    // Previously this was passed to `new Date(y, m, d, h, min, s)`, which
    // the JS runtime interprets using THIS PROCESS's own local timezone -
    // fine on a machine set to Mongolia time, but Azure App Service runs in
    // UTC, so "16:20" was silently treated as 16:20 UTC (= 00:20 the next
    // day in Mongolia) instead of 16:20 Mongolia time (= 08:20 UTC). That 8
    // hour miscalculation meant scheduled booking-open times never
    // actually arrived when admins expected them to.
    const asIfUtcMillis = Date.UTC(
      Number(isoLocalNoSeconds[1]),
      Number(isoLocalNoSeconds[2]) - 1,
      Number(isoLocalNoSeconds[3]),
      Number(isoLocalNoSeconds[4]),
      Number(isoLocalNoSeconds[5]),
      0,
    );
    return new Date(asIfUtcMillis - ULAANBAATAR_UTC_OFFSET_MS);
  }

  // Any other "YYYY-MM-DD[T ]HH:mm[:ss]" string with no timezone marker
  // (typically seconds ARE present here - a DB driver returning a naive
  // string instead of a Date object, or a value already produced by this
  // very function elsewhere in the codebase) is NOT fresh user input, and
  // must NOT get the Mongolia-offset treatment again - it already
  // represents the correct instant. Force it to be read as UTC explicitly
  // (appending 'Z') rather than handing the non-standard space-separated
  // format to `new Date(...)`, whose interpretation of such strings is not
  // reliably specified and varies by JS engine - previously this
  // ambiguity meant a booking-open time could show correctly right after
  // saving (fresh input, correctly offset) but flip to "not yet open" a
  // few seconds later once the same value round-tripped back from the
  // server and got reinterpreted here a second time.
  const isoAmbiguous = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (isoAmbiguous && !hasExplicitTimezone) {
    const asUtc = new Date(`${isoAmbiguous[1]}-${isoAmbiguous[2]}-${isoAmbiguous[3]}T${isoAmbiguous[4].padStart(2, '0')}:${isoAmbiguous[5]}:${isoAmbiguous[6] || '00'}Z`);
    if (!Number.isNaN(asUtc.getTime())) return asUtc;
  }

  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (us) {
    let hour = Number(us[4]);
    const period = us[7]?.toUpperCase();
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    const asIfUtcMillis = Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]), hour, Number(us[5]), Number(us[6] || 0));
    return new Date(asIfUtcMillis - ULAANBAATAR_UTC_OFFSET_MS);
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
