/**
 * Background polling that behaves itself.
 *
 * A plain `setInterval(fetchSomething, 2000)` has three problems that only
 * show up under load, which is precisely when they hurt most:
 *
 *  1. It keeps firing while the tab is hidden. Every CSR who leaves the
 *     dashboard open in a background tab all day keeps hammering the server
 *     for data nobody is looking at.
 *  2. It fires again whether or not the previous request finished. When the
 *     server is slow - again, exactly during a rush - requests pile up on top
 *     of each other and make the overload worse in a feedback loop.
 *  3. Every client that loaded the page at the same time (e.g. everyone
 *     opening it when booking opens) polls in lockstep, so the requests
 *     arrive in synchronised waves instead of spread out.
 *
 * startPolling fixes all three: it skips ticks while the document is hidden,
 * refreshes once immediately when the tab becomes visible again (so the user
 * never looks at stale data), never overlaps runs, and staggers the first
 * tick by a small random amount.
 *
 * Returns a cleanup function - call it from a useEffect cleanup.
 */
export function startPolling(
  task: () => void | Promise<unknown>,
  intervalMs: number,
  options: {
    /** Run once straight away, before the first interval elapses. */
    immediate?: boolean;
    /** Spread the first tick over this fraction of the interval (0-1). */
    jitterRatio?: number;
  } = {},
): () => void {
  const { immediate = false, jitterRatio = 0.2 } = options;

  let stopped = false;
  let running = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let startTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    if (stopped || running) return;
    // Nobody is looking at this tab - don't spend the user's battery or the
    // server's capacity on it. The visibilitychange handler below catches up
    // the moment they come back.
    if (typeof document !== 'undefined' && document.hidden) return;

    running = true;
    try {
      await task();
    } catch {
      // Individual pollers already handle and log their own errors; a
      // rejected promise here must never break the polling loop itself.
    } finally {
      running = false;
    }
  };

  const handleVisibilityChange = () => {
    if (!document.hidden) void run();
  };

  if (immediate) void run();

  // Stagger the start so that clients which loaded the page together don't
  // then poll in a synchronised wave for the rest of the session.
  const startDelay = Math.floor(Math.random() * intervalMs * jitterRatio);
  startTimeoutId = setTimeout(() => {
    if (stopped) return;
    void run();
    intervalId = setInterval(run, intervalMs);
  }, startDelay);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  return () => {
    stopped = true;
    if (startTimeoutId !== undefined) clearTimeout(startTimeoutId);
    if (intervalId !== undefined) clearInterval(intervalId);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}
