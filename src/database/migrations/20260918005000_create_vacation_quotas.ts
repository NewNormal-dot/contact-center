import type { Knex } from "knex";
import { tableExists } from "../schemaUtils";

/**
 * The admin's "how many people may take vacation in month N" setting.
 *
 * Before this table it lived in localStorage, and not merely per-browser:
 * the admin wrote the key "monthlyQuotas" (keyed by month INDEX 0-11) while
 * the CSR dashboard read a different key, "vacationQuotas" (keyed by
 * "YYYY-MM"), which nothing in the codebase ever wrote. The control reached
 * no one at all, and every CSR saw the hardcoded fallback of 5.
 *
 * Keyed by month number 1-12 rather than "YYYY-MM" because that is what the
 * admin UI actually offers: twelve months and no year picker. Making it
 * per-year would mean inventing a year selector and deciding what an unset
 * year inherits - a product decision, not a bug fix.
 *
 * Guarded with tableExists because production runs with
 * SKIP_DB_MIGRATIONS=true and applies migrations by hand.
 */
export async function up(knex: Knex): Promise<void> {
  if (await tableExists(knex, "vacation_quotas")) return;
  await knex.schema.createTable("vacation_quotas", (table) => {
    table.uuid("id").primary();
    table.integer("month").notNullable().unique();
    // "limit" is a reserved word in T-SQL, hence the prefix.
    table.integer("quota_limit").notNullable().defaultTo(5);
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("vacation_quotas");
}
