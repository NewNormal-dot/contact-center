import type { Knex } from 'knex';
import { columnExists } from '../schemaUtils';

// Adds the `location` dimension (Ulaanbaatar / Darkhan) so schedules can be
// managed independently per location, on top of the existing
// segment + employment-type split (Location -> Segment -> Employment Type).
//
// IMPORTANT, per explicit product decision: `forecast_data` is intentionally
// NOT touched here. Forecast represents company-wide contact volume across
// all locations combined (used for overall headcount planning), not a
// per-location breakdown, so it must stay as-is.
//
// Both new columns are added as NOT NULL with a default of 'Ulaanbaatar'.
// This means every row that already exists today automatically becomes a
// valid, fully-populated row the moment this migration runs - no backfill
// script, no nullable/ambiguous state, and nothing for existing
// segment/employment-type schedules to break. New rows going forward simply
// pass an explicit location like any other field.
export async function up(knex: Knex): Promise<void> {
  const hasWorkSlotLocation = await columnExists(knex, 'work_slots', 'location');
  if (!hasWorkSlotLocation) {
    await knex.schema.alterTable('work_slots', (table) => {
      table.string('location', 20).notNullable().defaultTo('Ulaanbaatar');
    });
    await knex.schema.alterTable('work_slots', (table) => {
      table.index(['date', 'location', 'segment', 'employment_type'], 'idx_work_slots_location_lookup');
    });
  }

  const hasRuleLocation = await columnExists(knex, 'shift_rule_settings', 'location');
  if (!hasRuleLocation) {
    await knex.schema.alterTable('shift_rule_settings', (table) => {
      table.string('location', 20).notNullable().defaultTo('Ulaanbaatar');
    });
    await knex.schema.alterTable('shift_rule_settings', (table) => {
      table.index(
        ['rule_type', 'month_key', 'location', 'segment', 'employment_type'],
        'idx_shift_rule_settings_location_lookup',
      );
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasWorkSlotLocation = await columnExists(knex, 'work_slots', 'location');
  if (hasWorkSlotLocation) {
    await knex.schema.alterTable('work_slots', (table) => {
      table.dropIndex(['date', 'location', 'segment', 'employment_type'], 'idx_work_slots_location_lookup');
    });
    await knex.schema.alterTable('work_slots', (table) => {
      table.dropColumn('location');
    });
  }

  const hasRuleLocation = await columnExists(knex, 'shift_rule_settings', 'location');
  if (hasRuleLocation) {
    await knex.schema.alterTable('shift_rule_settings', (table) => {
      table.dropIndex(
        ['rule_type', 'month_key', 'location', 'segment', 'employment_type'],
        'idx_shift_rule_settings_location_lookup',
      );
    });
    await knex.schema.alterTable('shift_rule_settings', (table) => {
      table.dropColumn('location');
    });
  }
}
