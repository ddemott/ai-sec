/**
 * WHO:   src/services/csv.ts — hand-rolled RFC-4180 serializer + parser
 * WHAT:  csvEscape / toCsv (export side) and parseCsv (import side)
 * WHEN:  every CSV export download and every POST /customers/import
 * WHERE: exportData.ts CSV routes + customers.ts import route
 * WHY:   the repo ships no csv dependency, so these two functions ARE the
 *        format contract. A broken escape corrupts an owner's spreadsheet;
 *        a missing formula-injection guard turns a malicious caller name
 *        ("=HYPERLINK(...)") into code execution in Excel; a parser bug
 *        silently mangles imported customer data.
 */
import { describe, it, expect } from 'vitest';
import { csvEscape, toCsv, parseCsv, CsvParseError } from '../../src/services/csv';

describe('csvEscape', () => {
  it('HAPPY: plain values pass through unquoted', () => {
    expect(csvEscape('Bella')).toBe('Bella');
    expect(csvEscape(42)).toBe('42');
  });

  it('HAPPY: null/undefined become the empty string', () => {
    // WHY: DB NULLs (email, notes) must not serialize as the string "null".
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('HAPPY: Date values serialize as ISO-8601', () => {
    // WHY: pg returns timestamptz columns as JS Dates; the export must be
    // machine-parseable, not locale-dependent toString() output.
    expect(csvEscape(new Date('2026-07-04T12:00:00Z'))).toBe('2026-07-04T12:00:00.000Z');
  });

  it('ESCAPING: a field containing a comma is quoted', () => {
    expect(csvEscape('Smith, Jane')).toBe('"Smith, Jane"');
  });

  it('ESCAPING: embedded double-quotes are doubled and the field quoted', () => {
    expect(csvEscape('the "best" salon')).toBe('"the ""best"" salon"');
  });

  it('ESCAPING: a field containing a newline is quoted (CR and LF)', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('SECURITY: fields starting with = + - @ get a leading single quote (formula injection)', () => {
    // WHO: a caller who tells the voice agent their name is a formula.
    // WHY: Excel/Sheets execute =/+/-/@-prefixed cells; the quote renders
    //      them as inert text.
    expect(csvEscape('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvEscape('@evil')).toBe("'@evil");
    expect(csvEscape('-2+3')).toBe("'-2+3");
    expect(csvEscape('+16305550001')).toBe("'+16305550001");
  });

  it('SECURITY: formula guard composes with quoting when the field also needs quotes', () => {
    expect(csvEscape('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
  });

  it('SECURITY: a trigger hidden behind leading whitespace/control chars still gets the guard', () => {
    // WHO:   a caller whose name is a formula padded with a leading tab/space.
    // WHAT:  spreadsheets ignore leading whitespace when deciding "is this a
    //        formula?", so "\t=HYPERLINK(1)" and " =SUM(1,1)" bypass a guard
    //        that only checks the FIRST character — the widened regex catches
    //        the trigger among leading whitespace.
    // WHEN:  every export of a field that begins with whitespace + a trigger.
    // WHERE: csvEscape's FORMULA_TRIGGER guard.
    // WHY:   the quote must be the TRUE first character so the whole cell
    //        (whitespace included) renders as inert text, not a formula.
    // No comma/quote/CR/LF here, so the cell is guarded but NOT quote-wrapped.
    expect(csvEscape('\t=HYPERLINK(1)')).toBe("'\t=HYPERLINK(1)");
    // The comma inside SUM(1,1) forces RFC-4180 quote-wrapping around the guard.
    expect(csvEscape(' =SUM(1,1)')).toBe('"\' =SUM(1,1)"');
    expect(csvEscape('  @evil')).toBe("'  @evil");
  });
});

describe('toCsv', () => {
  it('HAPPY: header + rows joined with CRLF, trailing CRLF', () => {
    const csv = toCsv(
      ['name', 'phone'],
      [
        ['Ann', '5551234'],
        ['Bob, Jr.', null],
      ]
    );
    expect(csv).toBe('name,phone\r\nAnn,5551234\r\n"Bob, Jr.",\r\n');
  });
});

describe('parseCsv', () => {
  it('HAPPY: parses simple rows (LF line endings)', () => {
    expect(parseCsv('a,b\n1,2\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('HAPPY: parses CRLF line endings and a UTF-8 BOM', () => {
    // WHY: Excel "CSV UTF-8" saves with a BOM + CRLF — the most common real
    // input for the customer-import feature.
    expect(parseCsv('\uFEFF' + 'name,phone\r\nAnn,555\r\n')).toEqual([
      ['name', 'phone'],
      ['Ann', '555'],
    ]);
  });

  it('HAPPY: quoted fields keep embedded commas, newlines, and doubled quotes', () => {
    const csv = 'name,notes\n"Smith, Jane","likes ""quiet""\nprefers Tuesdays"\n';
    expect(parseCsv(csv)).toEqual([
      ['name', 'notes'],
      ['Smith, Jane', 'likes "quiet"\nprefers Tuesdays'],
    ]);
  });

  it('HAPPY: empty fields and empty quoted fields parse as empty strings', () => {
    expect(parseCsv('a,,c\n"",x,\n')).toEqual([
      ['a', '', 'c'],
      ['', 'x', ''],
    ]);
  });

  it('HAPPY: blank lines between/after records are dropped (no phantom rows)', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('HAPPY: a multi-comma all-empty row (,,) is dropped, not kept as phantom', () => {
    // WHO:   an owner uploading a spreadsheet with stray comma-only lines
    //        (Excel emits ",," for a visually blank row that once held columns).
    // WHAT:  ",," parses to ['','',''] — three empty fields, not the ['']
    //        single-empty shape — so a shape-specific filter would keep it and
    //        reintroduce a phantom blank customer record.
    // WHEN:  every POST /customers/import that contains blank filler rows.
    // WHERE: parseCsv's entirely-empty-row filter.
    // WHY:   an all-empty row carries no data; a row with ANY value is kept.
    expect(parseCsv('a,b,c\n,,\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    // SAD-adjacent: a row with even one non-empty field must survive.
    expect(parseCsv('a,b,c\n,x,\n')).toEqual([
      ['a', 'b', 'c'],
      ['', 'x', ''],
    ]);
  });

  it('ROUND-TRIP: toCsv output parses back to the original values', () => {
    // WHY: an exported customers.csv should be re-importable unchanged.
    // (Values avoid the =+-@ formula guard, which deliberately mutates.)
    const rows = [
      ['Ann "The Hammer" Smith', 'notes, with commas'],
      ['multi\nline', ''],
    ];
    expect(parseCsv(toCsv(['name', 'notes'], rows))).toEqual([['name', 'notes'], ...rows]);
  });

  it('SAD: an unclosed quoted field throws CsvParseError', () => {
    // WHO: an owner uploading a hand-edited file with a stray quote.
    // WHY: silently guessing at structure would import garbage rows.
    expect(() => parseCsv('name,phone\n"Ann,555\n')).toThrow(CsvParseError);
    expect(() => parseCsv('name,phone\n"Ann,555\n')).toThrow(/Unclosed quoted field/);
  });

  it('SAD: content after a closing quote throws CsvParseError with the line number', () => {
    expect(() => parseCsv('a,b\n"x"y,2\n')).toThrow(CsvParseError);
    expect(() => parseCsv('a,b\n"x"y,2\n')).toThrow(/line 2/);
  });

  it('SAD: a quote in the middle of an unquoted field throws CsvParseError', () => {
    expect(() => parseCsv('a,b\nx"y,2\n')).toThrow(CsvParseError);
  });
});
