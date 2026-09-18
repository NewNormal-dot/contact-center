/**
 * The columns that make a shift *that* shift.
 *
 * Shared by the unique index (migration 20260918007000), the duplicate
 * inspection/merge endpoints, and slotIdentity() in src/api/slots.ts. One
 * definition, because a second copy drifting out of step is how the vacation
 * quota ended up written under one key and read under another.
 *
 * Capacity is deliberately absent: it is a property of a shift, not part of
 * its identity, which is why re-saving a shift updates capacity in place.
 */
export const SLOT_IDENTITY_COLUMNS = [
  'date',
  'start_time',
  'end_time',
  'segment',
  'employment_type',
  'location',
  'is_rest',
] as const;

export const SLOT_UNIQUE_INDEX = 'uq_work_slots_identity';
export const SLOT_NONUNIQUE_INDEX = 'ix_work_slots_identity';
