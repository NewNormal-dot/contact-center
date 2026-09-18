/**
 * Whether an error is the database refusing a duplicate on a unique key.
 *
 * Every dialect reports this differently, and getting it wrong in either
 * direction is costly: treating an unrelated failure as a duplicate hides a
 * real bug, and failing to recognise a genuine duplicate turns an ordinary
 * race into a 500 for the user.
 *
 * Lived in broadcasts.ts until the work_slots unique index gave a second
 * caller a reason to need it.
 */
export function isDuplicateKeyError(err: any): boolean {
  const number = err?.number ?? err?.originalError?.info?.number;
  if (number === 2627 || number === 2601) return true; // mssql PK / unique index
  const code = String(err?.code || '');
  if (code === 'SQLITE_CONSTRAINT' || code === '23505') return true; // sqlite / postgres
  return /duplicate|unique constraint|primary key/i.test(String(err?.message || ''));
}
