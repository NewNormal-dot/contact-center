import type { Knex } from "knex";

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
  if (getClientName(knex) === "mssql") {
    const fullName = escapeSqlString(objectName(schemaName, tableName));
    const result = await knex.raw(
      `SELECT 1 AS [exists] WHERE OBJECT_ID(N'${fullName}', N'U') IS NOT NULL`
    );
    return getRows(result).length > 0;
  }

  return knex.schema.hasTable(tableName);
}

export async function columnExists(
  knex: Knex,
  tableName: string,
  columnName: string,
  schemaName = "dbo"
): Promise<boolean> {
  if (getClientName(knex) === "mssql") {
    const fullName = escapeSqlString(objectName(schemaName, tableName));
    const column = escapeSqlString(columnName);
    const result = await knex.raw(
      `SELECT 1 AS [exists] WHERE COL_LENGTH(N'${fullName}', N'${column}') IS NOT NULL`
    );
    return getRows(result).length > 0;
  }

  return knex.schema.hasColumn(tableName, columnName);
}
