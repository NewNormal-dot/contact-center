import type { Knex } from "knex";
import { tableExists } from "../schemaUtils";

export async function up(knex: Knex): Promise<void> {
  const hasHolidays = await tableExists(knex, "holidays");
  if (!hasHolidays) {
    await knex.schema.createTable("holidays", (table) => {
      table.uuid("id").primary();
      // One holiday entry per calendar date.
      table.string("date").notNullable().unique();
      table.string("name").notNullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }

  const hasSegments = await tableExists(knex, "segments");
  if (!hasSegments) {
    await knex.schema.createTable("segments", (table) => {
      table.uuid("id").primary();
      table.string("name").notNullable().unique();
      // Preserves the admin's chosen display/tab order in the UI.
      table.integer("display_order").notNullable().defaultTo(0);
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("segments");
  await knex.schema.dropTableIfExists("holidays");
}
