import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils';

// Booking "waves" (Өглөөний slot / Оройн slot, each with its own quota and
// its own open/close window) existed only in the admin's browser:
//
//   * the client sent `bookingWaveId` with every booking and the server
//     never read it;
//   * slot_bookings had no column to record which wave a booking belonged
//     to, so getWaveBookedCount() always returned 0 for a named wave;
//   * work_slots had nowhere to store the configuration, so
//     mapDbSlotsToSchedules REGENERATED the waves from scratch on every
//     poll as Morning = capacity / Evening = 0 - discarding whatever split
//     the admin had just set, a few seconds after they set it.
//
// So the admin configured a split that did nothing and reset itself, while
// capacity behaved as one undivided pool.
//
// These two columns make the feature real. Both are nullable and the
// application treats "no waves recorded" as "one undivided pool", which is
// exactly how every existing row behaves today - so applying this migration
// changes nothing until an admin actually saves a wave split.
export async function up(knex: Knex): Promise<void> {
  if (!(await columnExists(knex, 'work_slots', 'booking_waves'))) {
    await knex.schema.alterTable('work_slots', (table) => {
      // JSON as text: Azure SQL has no jsonb, and the rest of this schema
      // already stores JSON this way (see shift_rule_settings.value_text).
      table.text('booking_waves').nullable();
    });
  }

  if (!(await columnExists(knex, 'slot_bookings', 'booking_wave_id'))) {
    await knex.schema.alterTable('slot_bookings', (table) => {
      table.string('booking_wave_id', 64).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await columnExists(knex, 'slot_bookings', 'booking_wave_id')) {
    await knex.schema.alterTable('slot_bookings', (table) => {
      table.dropColumn('booking_wave_id');
    });
  }
  if (await columnExists(knex, 'work_slots', 'booking_waves')) {
    await knex.schema.alterTable('work_slots', (table) => {
      table.dropColumn('booking_waves');
    });
  }
}
