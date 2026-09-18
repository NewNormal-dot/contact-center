import type { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";
import { tableExists } from "../schemaUtils";

/**
 * A unique index on the natural key of a shift.
 *
 * slot_bookings has carried UNIQUE(slot_id, user_id) since the initial
 * schema, and that constraint is what made the cancel-then-rebook bug
 * (F-01) surface as a loud 500 rather than as silent duplicate rows.
 * work_slots had no equivalent: "the same shift must not exist twice" was
 * enforced only by application code that reads, decides, then writes.
 *
 * Every writer already looks the row up first - sync-schedules matches on
 * slotIdentity(), and the trade path's findOrCreateAdjustedSlot does a
 * find-before-insert on exactly these columns. What none of them can do is
 * close the window between the SELECT and the INSERT. Two admins saving
 * overlapping schedules at the same moment, or two CSRs accepting trades
 * that need the same adjusted shift, both land in it.
 *
 * The column list matches slotIdentity() in src/api/slots.ts. Capacity is
 * deliberately NOT part of it: capacity is a property of a shift, not part
 * of what makes it that shift, which is why a re-save updates it in place.
 *
 * SAFETY
 * ------
 * Creating a unique index on a table that already contains duplicates
 * fails. In this deployment that would be worse than not having the index:
 * production applies migrations by hand through run-migrations, a throw
 * aborts the batch, and every LATER migration would stop running too.
 *
 * So the duplicates are counted first. If any exist the index is still
 * created, but non-unique - it remains useful for lookups - and the
 * situation is reported loudly instead of silently skipped. Someone has to
 * merge those rows by hand, because doing it automatically would mean
 * deleting shifts that people may be booked onto.
 */
const IDENTITY_COLUMNS = [
  "date",
  "start_time",
  "end_time",
  "segment",
  "employment_type",
  "location",
  "is_rest",
];

const INDEX_NAME = "uq_work_slots_identity";

export async function up(knex: Knex): Promise<void> {
  if (!(await tableExists(knex, "work_slots"))) return;

  const columnList = IDENTITY_COLUMNS.map((c) => `"${c}"`).join(", ");
  const grouped = await knex("work_slots")
    .select(IDENTITY_COLUMNS)
    .count({ n: "*" })
    .groupBy(IDENTITY_COLUMNS)
    .havingRaw("count(*) > 1");

  const duplicateGroups = grouped.length;

  if (duplicateGroups > 0) {
    const sample = grouped
      .slice(0, 10)
      .map(
        (row: any) =>
          `${row.date} ${row.start_time}-${row.end_time} ` +
          `${row.segment}/${row.employment_type}/${row.location} x${row.n}`,
      )
      .join("; ");

    console.error(
      `[${INDEX_NAME}] NOT created as UNIQUE: work_slots already contains ` +
        `${duplicateGroups} duplicate identity group(s). A non-unique index ` +
        `was created instead. These rows must be merged by hand - deleting ` +
        `them automatically could destroy shifts people are booked onto. ` +
        `Columns: ${columnList}. Sample: ${sample}`,
    );

    // Recorded where a superadmin can actually find it. A console line on
    // App Service is gone at the next restart, which is precisely how this
    // class of problem stays invisible.
    if (await tableExists(knex, "server_errors")) {
      await knex("server_errors")
        .insert({
          // uuid, not lower(hex(randomblob(16))): randomblob is a SQLite
          // builtin and does not exist on Azure SQL, so on the one database
          // this branch actually matters for, the write would fail and the
          // superadmin would be told nothing at all.
          id: uuidv4(),
          context: `migration ${INDEX_NAME}`,
          message:
            `work_slots has ${duplicateGroups} duplicate identity group(s); ` +
            `unique index not created. Sample: ${sample}`,
          stack: null,
          created_at: new Date().toISOString(),
        })
        .catch(() => undefined);
    }

    await createIndex(knex, false);
    return;
  }

  await createIndex(knex, true);
}

/**
 * Creates the index, tolerating it already being there.
 *
 * Production applies migrations by hand through run-migrations, so this can
 * legitimately run against a database where an earlier attempt already
 * succeeded - knex's bookkeeping is not the only thing that can get out of
 * step with reality here. An "already exists" error would abort the batch
 * and stop every later migration, which is the precise failure this
 * migration's whole duplicate-counting dance exists to avoid.
 */
async function createIndex(knex: Knex, unique: boolean) {
  try {
    await knex.schema.alterTable("work_slots", (table) => {
      if (unique) table.unique(IDENTITY_COLUMNS, { indexName: INDEX_NAME });
      else table.index(IDENTITY_COLUMNS, "ix_work_slots_identity");
    });
  } catch (err: any) {
    const message = String(err?.message || err);
    if (/already exists|duplicate key name|is already/i.test(message)) {
      console.log(`[${INDEX_NAME}] index already present, nothing to do`);
      return;
    }
    throw err;
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await tableExists(knex, "work_slots"))) return;
  await knex.schema
    .alterTable("work_slots", (table) => {
      table.dropUnique(IDENTITY_COLUMNS, INDEX_NAME);
    })
    .catch(() => undefined);
  await knex.schema
    .alterTable("work_slots", (table) => {
      table.dropIndex(IDENTITY_COLUMNS, "ix_work_slots_identity");
    })
    .catch(() => undefined);
}
