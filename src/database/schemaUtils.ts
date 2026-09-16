import type { Knex } from "knex";

// Table/column existence never changes while the server process is running
// (it only changes when a migration runs, which happens at deploy/startup,
// before requests are served). Previously tableExists()/columnExists() ran a
// real DB round-trip on every single call - and columnExists() in particular
// was being called on nearly every auth-related request (login, register,
// change-password, reset-password, etc). Caching the result in memory for
// the lifetime of the process removes that DB hit after the first check,
// with no behavioral change.
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

  existsCache.set(cacheKey, result);
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

  existsCache.set(cacheKey, result);
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
