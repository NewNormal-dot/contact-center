/**
 * How often each dashboard re-asks the server for data, in milliseconds.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * These intervals used to be magic numbers scattered across three dashboard
 * components, and they were extremely aggressive: the schedule was re-fetched
 * every 2 seconds, shift rules and trades every 5, and several more lists
 * every 10. That is fine with a handful of people online. It is not fine
 * during a booking rush.
 *
 * With 200 CSRs on the old intervals the server received roughly:
 *
 *     /slots                 200 / 2s  = 100 requests/sec
 *     /rules                 200 / 5s  =  40 requests/sec
 *     /trades                200 / 5s  =  40 requests/sec
 *     /broadcasts, /requests 200 / 10s =  60 requests/sec
 *     /settings/holidays     200 / 30s =   7 requests/sec
 *     ------------------------------------------------------
 *     total                            ≈ 247 requests/sec
 *
 * ...every one of which also ran its own database queries. A single-vCPU
 * App Service instance simply cannot serve that, which is why the site
 * became unreachable exactly when the most people needed it.
 *
 * The values below bring that to roughly 15 requests/sec for the same 200
 * users, and the remaining polls are mostly answered with an empty HTTP 304
 * ("nothing changed") rather than a full payload.
 *
 * FRESHNESS IS NOT LOST. Anything the user does themselves - booking,
 * cancelling, trading, an admin saving a schedule - re-fetches immediately,
 * so their own actions still appear instantly. Polling only covers changes
 * made by OTHER people, where a few seconds of delay is invisible in
 * practice. Polling also pauses entirely while the browser tab is in the
 * background (see startPolling), so idle tabs left open overnight cost
 * nothing at all.
 */
export const POLLING_INTERVALS = {
  /** The shift schedule itself (GET /api/slots) - the heaviest endpoint. */
  SCHEDULE: 15_000,

  /** Shift trade requests between CSRs. */
  TRADES: 20_000,

  /** Weekly/monthly shift rules. These change very rarely - an admin edits
   *  them once in a while, not continuously. */
  RULES: 60_000,

  /** Broadcast notifications. */
  NOTIFICATIONS: 30_000,

  /** Leave (hourly) and vacation requests. */
  REQUESTS: 30_000,

  /** Public holidays. Edited a couple of times a year. */
  HOLIDAYS: 300_000,

  /** Purely local (localStorage) state - no network, no database. Cheap, so
   *  it can stay responsive. */
  LOCAL_DATA: 5_000,

  /** The superadmin console: user list, audit log, notifications. The audit
   *  log in particular is an expensive query, and a superadmin watching it
   *  does not need second-by-second updates. */
  SUPERADMIN: 30_000,
} as const;
