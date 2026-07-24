import type { Knex } from "knex";
import { columnExists } from "../schemaUtils";

// Previously, deleting a user CASCADE-deleted all their slot_bookings and
// leave_requests too - meaning their entire schedule/attendance history
// vanished along with the account. This migration changes that: booking and
// leave-request rows now survive user deletion (their user_id becomes NULL
// instead of the row being removed), and a denormalized snapshot of the
// user's name/code is stored directly on each row so historical reports
// remain meaningful even after the account is long gone.
export async function up(knex: Knex): Promise<void> {
  const hasBookingUserName = await columnExists(knex, "slot_bookings", "user_name");
  if (!hasBookingUserName) {
    await knex.schema.alterTable("slot_bookings", (table) => {
      table.string("user_name");
      table.string("user_code");
    });
  }

  const hasLeaveUserName = await columnExists(knex, "leave_requests", "user_name");
  if (!hasLeaveUserName) {
    await knex.schema.alterTable("leave_requests", (table) => {
      table.string("user_name");
      table.string("user_code");
    });
  }

  // Backfill existing rows from the current users table so historical data
  // created before this migration also gets a name/code snapshot.
  await knex.raw(`
    UPDATE slot_bookings
    SET user_name = (SELECT name FROM users WHERE users.id = slot_bookings.user_id),
        user_code = (SELECT code FROM users WHERE users.id = slot_bookings.user_id)
    WHERE user_id IS NOT NULL AND user_name IS NULL
  `);
  await knex.raw(`
    UPDATE leave_requests
    SET user_name = (SELECT name FROM users WHERE users.id = leave_requests.user_id),
        user_code = (SELECT code FROM users WHERE users.id = leave_requests.user_id)
    WHERE user_id IS NOT NULL AND user_name IS NULL
  `);

  // Change the delete behavior from CASCADE to SET NULL: the historical row
  // stays, only the live link to the (now-deleted) user account is severed.
  await knex.schema.alterTable("slot_bookings", (table) => {
    table.dropForeign("user_id");
  });
  await knex.schema.alterTable("slot_bookings", (table) => {
    table.foreign("user_id").references("id").inTable("users").onDelete("SET NULL");
  });

  await knex.schema.alterTable("leave_requests", (table) => {
    table.dropForeign("user_id");
  });
  await knex.schema.alterTable("leave_requests", (table) => {
    table.foreign("user_id").references("id").inTable("users").onDelete("SET NULL");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("slot_bookings", (table) => {
    table.dropForeign("user_id");
  });
  await knex.schema.alterTable("slot_bookings", (table) => {
    table.foreign("user_id").references("id").inTable("users").onDelete("CASCADE");
  });

  await knex.schema.alterTable("leave_requests", (table) => {
    table.dropForeign("user_id");
  });
  await knex.schema.alterTable("leave_requests", (table) => {
    table.foreign("user_id").references("id").inTable("users").onDelete("CASCADE");
  });

  const hasBookingUserName = await columnExists(knex, "slot_bookings", "user_name");
  if (hasBookingUserName) {
    await knex.schema.alterTable("slot_bookings", (table) => {
      table.dropColumn("user_name");
      table.dropColumn("user_code");
    });
  }

  const hasLeaveUserName = await columnExists(knex, "leave_requests", "user_name");
  if (hasLeaveUserName) {
    await knex.schema.alterTable("leave_requests", (table) => {
      table.dropColumn("user_name");
      table.dropColumn("user_code");
    });
  }
}
