import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const clientName = (knex as any).client?.config?.client;
  let exists = false;

  if (clientName === 'mssql') {
    const result: any = await knex.raw("SELECT 1 AS [exists] WHERE OBJECT_ID(N'[dbo].[forecast_data]', N'U') IS NOT NULL");
    const rows = Array.isArray(result) ? result : (result?.recordset || result?.rows || []);
    exists = Array.isArray(rows) && rows.length > 0;
  } else {
    exists = await knex.schema.hasTable('forecast_data');
  }

  if (exists) return;

  await knex.schema.createTable('forecast_data', (table) => {
    table.string('id').primary();
    table.dateTime('date_time').notNullable();
    table.string('month_key', 7).notNullable();
    table.string('segment').notNullable();
    table.integer('forecast').notNullable().defaultTo(0);
    table.integer('hr').notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.index(['month_key', 'segment']);
    table.index(['date_time']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('forecast_data');
}
