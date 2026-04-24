import pkg, { type Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema
    .createTable('users', (table) => {
      table.uuid('id').primary();
      table.string('email').unique().notNullable();
      table.string('password_hash').notNullable();
      table.string('name').notNullable();
      table.enum('role', ['superadmin', 'admin', 'csr']).defaultTo('csr');
      table.enum('status', ['active', 'inactive']).defaultTo('active');
      table.string('photo_url');
      table.string('code');
      table.enum('employment_type', ['Full Time', 'Part Time']).defaultTo('Full Time');
      table.uuid('weekly_rule_id');
      table.timestamps(true, true);
    })
    .createTable('weekly_rule_templates', (table) => {
      table.uuid('id').primary();
      table.string('name').notNullable();
      table.text('description');
      table.integer('total_hours').notNullable();
      table.integer('rest_days_count').notNullable();
      table.jsonb('patterns').notNullable(); // Array of {duration, count}
      table.timestamps(true, true);
    })
    .createTable('work_slots', (table) => {
      table.uuid('id').primary();
      table.date('date').notNullable();
      table.time('start_time').notNullable();
      table.time('end_time').notNullable();
      table.float('duration').notNullable();
      table.integer('capacity').notNullable();
      table.dateTime('booking_deadline').notNullable();
      table.timestamps(true, true);
    })
    .createTable('slot_bookings', (table) => {
      table.uuid('id').primary();
      table.uuid('slot_id').references('id').inTable('work_slots').onDelete('CASCADE');
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.dateTime('booked_at').defaultTo(knex.fn.now());
      table.enum('status', ['confirmed', 'cancelled', 'auto-assigned']).defaultTo('confirmed');
    })
    .createTable('leave_requests', (table) => {
      table.uuid('id').primary();
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.date('date').notNullable();
      table.time('start_time').notNullable();
      table.time('end_time').notNullable();
      table.text('reason').notNullable();
      table.enum('status', ['pending', 'approved', 'rejected']).defaultTo('pending');
      table.uuid('approved_by').references('id').inTable('users');
      table.timestamps(true, true);
    })
    .createTable('vacation_requests', (table) => {
      table.uuid('id').primary();
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.date('start_date').notNullable();
      table.date('end_date').notNullable();
      table.text('reason').notNullable();
      table.enum('status', ['pending', 'approved', 'rejected']).defaultTo('pending');
      table.uuid('approved_by').references('id').inTable('users');
      table.timestamps(true, true);
    })
    .createTable('trade_requests', (table) => {
      table.uuid('id').primary();
      table.uuid('sender_id').references('id').inTable('users');
      table.uuid('receiver_id').references('id').inTable('users');
      table.uuid('sender_slot_id').references('id').inTable('work_slots');
      table.uuid('receiver_slot_id').references('id').inTable('work_slots');
      table.enum('status', ['pending', 'accepted', 'approved', 'rejected']).defaultTo('pending');
      table.uuid('approved_by').references('id').inTable('users');
      table.timestamps(true, true);
    })
    .createTable('notifications', (table) => {
      table.uuid('id').primary();
      table.string('title').notNullable();
      table.text('content').notNullable();
      table.string('image_url');
      table.dateTime('deadline');
      table.uuid('author_id').references('id').inTable('users');
      table.timestamps(true, true);
    })
    .createTable('notification_read_receipts', (table) => {
      table.uuid('notification_id').references('id').inTable('notifications').onDelete('CASCADE');
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.dateTime('read_at').defaultTo(knex.fn.now());
      table.primary(['notification_id', 'user_id']);
    })
    .createTable('trainings', (table) => {
      table.uuid('id').primary();
      table.string('title').notNullable();
      table.text('description').notNullable();
      table.string('attachment_url');
      table.string('attachment_name');
      table.dateTime('deadline');
      table.uuid('author_id').references('id').inTable('users');
      table.timestamps(true, true);
    })
    .createTable('training_completions', (table) => {
      table.uuid('training_id').references('id').inTable('trainings').onDelete('CASCADE');
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.dateTime('completed_at').defaultTo(knex.fn.now());
      table.primary(['training_id', 'user_id']);
    })
    .createTable('audit_logs', (table) => {
      table.uuid('id').primary();
      table.uuid('user_id').references('id').inTable('users');
      table.string('action').notNullable();
      table.string('entity_type').notNullable();
      table.uuid('entity_id');
      table.text('details');
      table.string('ip_address');
      table.timestamps(true, true);
    })
    .createTable('password_reset_tokens', (table) => {
      table.uuid('id').primary();
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.string('token').notNullable();
      table.dateTime('expires_at').notNullable();
      table.timestamps(true, true);
    });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema
    .dropTableIfExists('password_reset_tokens')
    .dropTableIfExists('audit_logs')
    .dropTableIfExists('training_completions')
    .dropTableIfExists('trainings')
    .dropTableIfExists('notification_read_receipts')
    .dropTableIfExists('notifications')
    .dropTableIfExists('trade_requests')
    .dropTableIfExists('vacation_requests')
    .dropTableIfExists('leave_requests')
    .dropTableIfExists('slot_bookings')
    .dropTableIfExists('work_slots')
    .dropTableIfExists('weekly_rule_templates')
    .dropTableIfExists('users');
}
