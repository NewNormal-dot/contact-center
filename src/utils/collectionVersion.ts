import { createHash } from 'node:crypto';

/**
 * Optimistic concurrency for the settings collections that are saved by
 * replacing the whole list.
 *
 * THE PROBLEM THIS SOLVES
 *
 * /holidays, /segments, /vacation-quotas and /shift-templates all persist by
 * deleting what is stored and inserting the list the client computed. The
 * client computes that list from whatever it fetched when the page loaded.
 * So:
 *
 *   09:00  admin A loads the page
 *   09:05  admin B loads the page
 *   09:10  admin A adds a holiday and saves      -> stored: [..., A's]
 *   09:12  admin B adds a different one and saves -> stored: [..., B's]
 *
 * B's save was built from the 09:05 snapshot, which never contained A's
 * entry, so A's work is gone. Nothing errors. A finds out when they notice
 * the holiday they added is missing, if they ever do. That is the whole of
 * F-09 - not a millisecond race, a minutes-wide one.
 *
 * HOW
 *
 * A GET returns an ETag derived from the stored rows. A PUT may send it back
 * as If-Match; if the stored state has changed since, the write is refused
 * with 409 and the current list, so the client can show what happened
 * instead of silently overwriting.
 *
 * Deliberately advisory: a PUT with no If-Match behaves exactly as before.
 * That keeps an un-updated client (a tab left open across a deploy, say)
 * working rather than failing every save with a header it has never heard of.
 */
export function collectionVersion(items: unknown[]): string {
  // Sorted, so the hash reflects CONTENT rather than row order - two reads
  // that return the same set in a different order must agree.
  const canonical = items
    .map((item) => JSON.stringify(item, Object.keys(item as object).sort()))
    .sort()
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** The ETag header value for a collection, quoted as HTTP requires. */
export function etagFor(items: unknown[]): string {
  return `"${collectionVersion(items)}"`;
}

/**
 * Whether the caller's If-Match matches what is stored.
 *
 * Returns true when the header is absent: the check is opt-in, so a client
 * that does not send one is not broken by it.
 */
export function versionMatches(req: any, current: unknown[]): boolean {
  const header = req?.headers?.['if-match'];
  if (!header) return true;
  const supplied = String(Array.isArray(header) ? header[0] : header).trim();
  if (supplied === '*') return true;
  return supplied.replace(/^W\//, '') === etagFor(current);
}
