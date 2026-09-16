import type { Knex } from "knex";

// Caching exists to remove a real DB round-trip from the hot path:
// columnExists() is called on nearly every auth-related request (login,
// register, change-password, reset-password, etc), always asking about the
// same handful of columns.
//
// ONLY POSITIVE RESULTS ARE CACHED, and that asymmetry is load-bearing.
// A table/column that exists can never stop existing while the process runs,
// so caching `true` is always safe. Caching `false` is NOT: migrations run
// inside this very process at startup, and each one checks for a column
// *before* adding it. A cached `false` from that check was still being
// returned to LATER migrations in the same run, which then wrongly believed
// the column was missing and silently skipped their own work. That is
// exactly how the notifications.target_user_id index was skipped at first -
// a bug that leaves no error behind, only a missing object.
const existsCache = new Map<string, boolean>();

function getClientName(knex: Knex) {
  return String((knex as any).client?.config?.client || "").toLowerCase();
}

function getRows(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.recordset)) return result.recordset;
  if (Array.isArray(result?.rows)) return result.rows;
  if (Array.isArray(result?.[0])) return result[0];
  return [];
}

function escapeSqlString(value: string) {
  return value.replace(/'/g, "''");
}

function bracketName(value: string) {
  return `[${value.replace(/]/g, "]]")}]`;
}

function objectName(schemaName: string, tableName: string) {
  return `${bracketName(schemaName)}.${bracketName(tableName)}`;
}

export async function tableExists(
  knex: Knex,
  tableName: string,
  schemaName = "dbo"
): Promise<boolean> {
  const cacheKey = `table:${getClientName(knex)}:${schemaName}.${tableName}`;
  const cached = existsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result: boolean;
  if (getClientName(knex) === "mssql") {
    const fullName = escapeSqlString(objectName(schemaName, tableName));
    const raw = await knex.raw(
      `SELECT 1 AS [exists] WHERE OBJECT_ID(N'${fullName}', N'U') IS NOT NULL`
    );
    result = getRows(raw).length > 0;
  } else {
    result = await knex.schema.hasTable(tableName);
  }

  if (result) existsCache.set(cacheKey, result);
  return result;
}

export async function columnExists(
  knex: Knex,
  tableName: string,
  columnName: string,
  schemaName = "dbo"
): Promise<boolean> {
  const cacheKey = `column:${getClientName(knex)}:${schemaName}.${tableName}.${columnName}`;
  const cached = existsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result: boolean;
  if (getClientName(knex) === "mssql") {
    const fullName = escapeSqlString(objectName(schemaName, tableName));
    const column = escapeSqlString(columnName);
    const raw = await knex.raw(
      `SELECT 1 AS [exists] WHERE COL_LENGTH(N'${fullName}', N'${column}') IS NOT NULL`
    );
    result = getRows(raw).length > 0;
  } else {
    result = await knex.schema.hasColumn(tableName, columnName);
  }

  if (result) existsCache.set(cacheKey, result);
  return result;
}

/**
 * Clears the cache used by tableExists()/columnExists(). Only needed if you
 * run migrations against a live process without restarting it (not the
 * normal deploy flow here, but exposed for tests/tools that might need it).
 */
export function clearSchemaExistsCache() {
  existsCache.clear();
}
