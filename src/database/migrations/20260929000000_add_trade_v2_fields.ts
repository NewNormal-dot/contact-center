import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils';

// 2026-09-29 trade rewrite - additive-only, defensive (production applies
// migrations by hand via POST /api/admin/run-migrations, so every reader of
// these columns MUST keep working before this migration has run - see
// hasTradeV2Columns() / hasAcquiredViaTradeColumn() in src/api/trades.ts).
//
// What each column is for:
//
//   trade_requests.expires_at
//     The absolute instant this pending request stops being actionable -
//     3 hours before whichever involved shift starts soonest. Replaces the
//     old "expire at midnight of the shift's date" sweep, which was too
//     coarse once trades became time-gated down to the hour.
//
//   trade_requests.sender_new_shift_summary / receiver_new_shift_summary
//     A human-readable snapshot ("2026-10-02 09:00-16:00") of what each
//     side's shift BECAME once the trade was approved. Filled in only at
//     accept time (NULL until then). work_slots rows can later be merged
//     or reused by scheduling changes, at which point a join in a history
//     view would go blank - the text snapshot keeps an approved trade
//     readable regardless of what happens to the row it produced.
//
//   slot_bookings.acquired_via_trade
//     True on both bookings a trade produces. A shift obtained by trading
//     must not become tradeable bait for a second trade (see the
//     "acquired-via-trade" guard in POST /api/trades and PATCH
//     /api/trades/:id/respond) - this is the flag that guard reads.
export async function up(knex: Knex): Promise<void> {
  if (!(await columnExists(knex, 'trade_requests', 'expires_at'))) {
    await knex.schema.alterTable('trade_requests', (table) => {
      table.dateTime('expires_at').nullable();
    });
    await knex.schema.alterTable('trade_requests', (table) => {
      table.index(['expires_at'], 'idx_trade_requests_expires_at');
    });
  }
  const summaryColumns = ['sender_new_shift_summary', 'receiver_new_shift_summary'];
  for (const column of summaryColumns) {
    if (!(await columnExists(knex, 'trade_requests', column))) {
      await knex.schema.alterTable('trade_requests', (table) => {
        table.string(column, 191).nullable();
      });
    }
  }
  if (!(await columnExists(knex, 'slot_bookings', 'acquired_via_trade'))) {
    await knex.schema.alterTable('slot_bookings', (table) => {
      table.boolean('acquired_via_trade').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await columnExists(knex, 'slot_bookings', 'acquired_via_trade')) {
    await knex.schema.alterTable('slot_bookings', (table) => {
      table.dropColumn('acquired_via_trade');
    });
  }
  const summaryColumns = ['sender_new_shift_summary', 'receiver_new_shift_summary'];
  for (const column of summaryColumns) {
    if (await columnExists(knex, 'trade_requests', column)) {
      await knex.schema.alterTable('trade_requests', (table) => {
        table.dropColumn(column);
      });
    }
  }
  if (await columnExists(knex, 'trade_requests', 'expires_at')) {
    await knex.schema
      .alterTable('trade_requests', (table) => {
        table.dropIndex(['expires_at'], 'idx_trade_requests_expires_at');
      })
      .catch(() => undefined);
    await knex.schema.alterTable('trade_requests', (table) => {
      table.dropColumn('expires_at');
    });
  }
}
