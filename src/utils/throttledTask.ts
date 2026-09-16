/**
 * Runs a housekeeping task at most once every `minIntervalMs`, no matter how
 * often it is triggered.
 *
 * Several GET endpoints in this app double as janitors: listing notifications
 * also purged old ones, listing trades also auto-declined expired ones. That
 * is a reasonable way to avoid needing a cron job - but it was wired to run
 * on EVERY request. With every dashboard polling in the background that
 * turned read-only endpoints into a constant stream of writes:
 *
 *   - purgeOldNotifications() ran a DELETE over the notifications table on
 *     every notification fetch, i.e. ~20 times a second with 200 CSRs online.
 *   - autoDeclineExpiredTrades() ran a five-table JOIN on every trade fetch,
 *     ~40 times a second.
 *
 * Neither needs to happen more than a few times an hour: they clean up rows
 * whose deadline passed at a date boundary. Throttling them keeps the exact
 * same behaviour while removing essentially all of the cost.
 *
 * The task is awaited on the (rare) call that actually runs it, so the
 * response that triggered it still reflects its result. Concurrent callers
 * while it is in flight skip it rather than piling up duplicate work.
 */
export function createThrottledTask(
  task: () => Promise<void>,
  minIntervalMs: number,
  label: string,
): () => Promise<void> {
  let lastRunAt = 0;
  let inFlight: Promise<void> | null = null;

  return async function trigger(): Promise<void> {
    if (inFlight) return;
    if (Date.now() - lastRunAt < minIntervalMs) return;

    lastRunAt = Date.now();
    inFlight = (async () => {
      try {
        await task();
      } catch (err) {
        // Housekeeping must never break the request that happened to
        // trigger it - the user asked for a list, not for a cleanup.
        console.error(`Throttled task "${label}" failed:`, err);
      } finally {
        inFlight = null;
      }
    })();

    await inFlight;
  };
}
