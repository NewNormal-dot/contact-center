import type { Knex } from "knex";
import { tableExists } from "../schemaUtils";

/**
 * The selectable shift times in the schedule builder ("09-18", "14-22",
 * "Амралт").
 *
 * Admins can add and remove these, and the list lived in each admin's own
 * localStorage - so two admins could be building schedules from different
 * sets of options without either of them knowing.
 *
 * Guarded with tableExists because production runs with
 * SKIP_DB_MIGRATIONS=true and applies migrations by hand.
 */
export async function up(knex: Knex): Promise<void> {
  if (await tableExists(knex, "shift_templates")) return;
  await knex.schema.createTable("shift_templates", (table) => {
    table.uuid("id").primary();
    // The normalised "HH-HH" / "HH:MM-HH:MM" form, or the rest-day label.
    // Unique so the same shift cannot be added twice from two browsers.
    table.string("time", 32).notNullable().unique();
    table.string("label", 64).notNullable();
    // Preserves the admin's chosen ordering in the picker.
    table.integer("display_order").notNullable().defaultTo(0);
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("shift_templates");
}
