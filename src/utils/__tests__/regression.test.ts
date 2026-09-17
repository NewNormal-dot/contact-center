import { describe, it, expect } from 'vitest';
import { toSqlDate, toSqlTime, toSqlDateTime, displayTime } from '../sqlDate';
import { sanitizeCell, sanitizeRows, sanitizeAoa } from '../excel';
import { getClientKey } from '../../middleware/rateLimiter';

// Each block below pins a bug that actually shipped. The comment says which.

describe('sqlDate - Mongolia (UTC+8, no DST) vs a UTC server', () => {
  it('reads a driver-returned TIME from its UTC fields, not the process timezone', () => {
    // A TIME column comes back from mssql (useUTC:true) as 1970-01-01T<t>Z.
    // Reading getHours() made the answer depend on the server's timezone:
    // right on a UTC App Service, eight hours out on a machine set to
    // Mongolia time, and wrong in production if WEBSITE_TIME_ZONE were set.
    const driverValue = new Date(Date.UTC(1970, 0, 1, 14, 30, 0));
    expect(toSqlTime(driverValue)).toBe('14:30:00');
    expect(displayTime(driverValue)).toBe('14:30');
  });

  it('treats a naive datetime-local string as Mongolian wall-clock time', () => {
    // The admin's <input type="datetime-local"> produces "YYYY-MM-DDTHH:mm".
    // 16:20 in Ulaanbaatar is 08:20 UTC.
    const parsed = toSqlDateTime('2026-09-18T16:20');
    expect(parsed?.toISOString()).toBe('2026-09-18T08:20:00.000Z');
  });

  it('does NOT re-apply the offset to a value that already round-tripped', () => {
    // This is the drift that made a booking window open and then revert to
    // "Товлогдсон" a few seconds later: the same instant was offset twice.
    const once = toSqlDateTime('2026-09-18T16:20')!;
    const twice = toSqlDateTime(once.toISOString())!;
    expect(twice.toISOString()).toBe(once.toISOString());
  });

  it('keeps an explicit UTC instant exactly as given', () => {
    expect(toSqlDateTime('2026-09-18T08:20:00.000Z')?.toISOString())
      .toBe('2026-09-18T08:20:00.000Z');
  });

  it('parses date-only strings without timezone slippage', () => {
    expect(toSqlDate('2026-09-18')).toBe('2026-09-18');
    expect(toSqlDate('2026-09-18T23:30:00+08:00')).toBe('2026-09-18');
  });

  it('rejects malformed times rather than inventing one', () => {
    expect(toSqlTime('25:00')).toBeNull();
    expect(toSqlTime('not a time')).toBeNull();
  });
});

describe('excel - formula injection in exports', () => {
  // Every export writes user-controlled values (names, emails, reasons,
  // audit details) into cells. A spreadsheet executes a cell starting with
  // = + - @ tab or CR as a FORMULA, and bulk import is exactly the path that
  // would introduce such a name.
  it.each(['=HYPERLINK("http://evil","x")', '+1+1', '-1+1', '@SUM(A1)', '\tx', '\rx'])(
    'neutralises %j',
    (dangerous) => {
      expect(sanitizeCell(dangerous)).toBe(`'${dangerous}`);
    },
  );

  it('leaves ordinary values untouched', () => {
    expect(sanitizeCell('Энхтөр')).toBe('Энхтөр');
    expect(sanitizeCell('a@b.mn')).toBe('a@b.mn');
    expect(sanitizeCell(42)).toBe(42);
    expect(sanitizeCell(null)).toBe(null);
  });

  it('covers every cell of a row export and an array-of-arrays export', () => {
    expect(sanitizeRows([{ Нэр: '=cmd', Имэйл: 'a@b.mn' }]))
      .toEqual([{ Нэр: "'=cmd", Имэйл: 'a@b.mn' }]);
    expect(sanitizeAoa([['ok', '=cmd']])).toEqual([['ok', "'=cmd"]]);
  });
});

describe('rateLimiter - X-Forwarded-For is client-controlled', () => {
  const req = (headers: Record<string, string>, socketAddress = '10.0.0.1') =>
    ({ headers, socket: { remoteAddress: socketAddress } }) as any;

  it('uses the proxy-appended last hop, not the caller-supplied first one', () => {
    // Taking hops[0] meant an attacker could send a different
    // X-Forwarded-For on every attempt and land each one in its own bucket,
    // defeating the login limiter entirely.
    expect(getClientKey(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })))
      .toBe('203.0.113.7');
  });

  it('strips the source port Azure appends', () => {
    expect(getClientKey(req({ 'x-forwarded-for': '203.0.113.7:51514' })))
      .toBe('203.0.113.7');
  });

  it('falls back to the socket address when the header is absent', () => {
    expect(getClientKey(req({}))).toBe('10.0.0.1');
  });

  it('cannot be reset by spoofing a longer chain', () => {
    const a = getClientKey(req({ 'x-forwarded-for': 'spoof-1, 203.0.113.7' }));
    const b = getClientKey(req({ 'x-forwarded-for': 'spoof-2, 203.0.113.7' }));
    expect(a).toBe(b);
  });
});
