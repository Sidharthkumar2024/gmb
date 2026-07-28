// Minimal, correct CSV writer (RFC 4180). A field is quoted when it contains a
// comma, quote, or newline; embedded quotes are doubled. Used for the admin/
// partner data exports — no dependency, and safe against values that would
// otherwise break row/column boundaries.

export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a CSV string from a header row + data rows. Ends with a trailing newline. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
