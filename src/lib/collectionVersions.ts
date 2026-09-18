/**
 * Remembers the ETag each settings collection was last fetched at, so a save
 * can tell the server which version it was built from.
 *
 * The settings collections (/settings/holidays, /segments, /vacation-quotas,
 * /shift-templates) are saved by sending the whole list, computed from
 * whatever the page fetched on load. Without this, two admins editing minutes
 * apart silently overwrite each other: the second save was built from a
 * snapshot that never contained the first admin's change (F-09).
 *
 * Module scope rather than component state on purpose: the same collection is
 * fetched from more than one place (a poll and a mount, say) and every saver
 * needs the newest version, not whichever one its own component happened to
 * see.
 *
 * Losing a version is safe. If-Match is simply omitted and the server behaves
 * as it did before - the check protects against the common case, it does not
 * become a new way for saving to fail.
 */
const versions = new Map<string, string>();

/** Records the ETag from a fetch, if the response carried one. */
export function rememberVersion(path: string, headers: any) {
  const etag = headers?.etag || headers?.ETag;
  if (etag) versions.set(path, String(etag));
}

/** Headers for a save: If-Match when a version is known, nothing otherwise. */
export function versionHeader(path: string): Record<string, string> {
  const etag = versions.get(path);
  return etag ? { 'If-Match': etag } : {};
}

/** After a rejected save, the stale version must not be reused. */
export function forgetVersion(path: string) {
  versions.delete(path);
}
