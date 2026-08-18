/**
 * Hand-rolled RFC-4180 CSV serializer + parser.
 *
 * WHY hand-rolled: the repo intentionally ships no csv/archiver dependency
 * ("no new deps" rule — same reasoning as the JSON tenant-data export in
 * exportData.ts). RFC 4180 is small enough to implement and pin with tests:
 *   - fields containing comma, double-quote, CR or LF are wrapped in quotes
 *   - embedded double-quotes are doubled ("")
 *   - records are separated by CRLF
 *
 * SECURITY — spreadsheet formula injection: a CSV opened in Excel/Sheets
 * executes cell content starting with = + - @ as a formula (classic
 * "=HYPERLINK(...)" / "=cmd|..." exfiltration via a malicious customer name
 * captured by the voice agent). Spreadsheets ignore leading whitespace/control
 * chars when deciding this, so the guard also fires when a trigger sits behind
 * leading whitespace (e.g. "\t=HYPERLINK(...)"). Any such field is prefixed
 * with a single quote (the true first character), which spreadsheets render as
 * harmless text. Applied on EXPORT only — parseCsv never mutates data.
 */

/**
 * Characters that trigger formula evaluation in Excel / Google Sheets, detected
 * even behind leading whitespace/control chars. Spreadsheets ignore leading
 * whitespace when deciding whether a cell is a formula, so "\t=HYPERLINK(...)"
 * or " =SUM(1,1)" would evaluate — the `[\s -]*` prefix catches those bypasses.
 */
const FORMULA_TRIGGER = /^[\s -]*[=+\-@]/;

/**
 * Escape a single value for a CSV cell (RFC 4180 + formula-injection guard).
 * null/undefined become the empty string; Dates serialize as ISO-8601.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str: string;
  if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === 'object') {
    str = JSON.stringify(value);
  } else if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    str = String(value);
  } else if (typeof value === 'symbol') {
    str = value.description ?? '';
  } else {
    str = JSON.stringify(value);
  }
  // Neutralize spreadsheet formulas BEFORE quoting so the guard is part of
  // the cell content (and survives the quote-wrapping below).
  if (FORMULA_TRIGGER.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize a header + row set into a CSV document (CRLF record separator,
 * trailing CRLF after the last record per RFC 4180 examples).
 */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines: string[] = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** Thrown by parseCsv on structurally invalid input (e.g. unclosed quote). */
export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

/**
 * Parse an RFC-4180 CSV document into rows of string fields.
 *
 * Handles: quoted fields, embedded commas/CR/LF inside quotes, doubled
 * quotes (""), CRLF or bare-LF record separators, and a UTF-8 BOM.
 * Fully-empty trailing lines are dropped (a trailing newline does not
 * produce a phantom empty record).
 *
 * Throws CsvParseError on an unclosed quoted field or on a quote appearing
 * in the middle of an unquoted field's content after a quoted section
 * (e.g. `"abc"def`).
 */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM — Excel prepends one when saving "CSV UTF-8".
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  /** True once the current field started with a quote (for `"abc"def` detection). */
  let fieldWasQuoted = false;
  let line = 1;

  const pushField = () => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escape pair
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (field.length === 0 && !fieldWasQuoted) {
        inQuotes = true;
        fieldWasQuoted = true;
      } else {
        throw new CsvParseError(`Unexpected quote in unquoted field on line ${line}`);
      }
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\r') {
      // Swallow; the record break is handled on the \n (lone \r also breaks).
      if (text[i + 1] !== '\n') {
        line++;
        pushRow();
      }
    } else if (ch === '\n') {
      line++;
      pushRow();
    } else {
      if (fieldWasQuoted) {
        throw new CsvParseError(`Unexpected content after closing quote on line ${line}`);
      }
      field += ch;
    }
  }

  if (inQuotes) {
    throw new CsvParseError('Unclosed quoted field — the CSV ends inside a quoted value');
  }
  // Flush the final record unless the document ended exactly on a newline.
  if (field.length > 0 || fieldWasQuoted || row.length > 0) {
    pushRow();
  }

  // Drop records that are entirely empty (blank lines between/after data).
  // A blank line parses to `['']`, but a line like `,,` parses to
  // `['', '', '']` — both are phantom rows, so drop any row whose every field
  // is empty. A row with even one data-bearing field is kept untouched.
  return rows.filter((r) => !r.every((f) => f === ''));
}
