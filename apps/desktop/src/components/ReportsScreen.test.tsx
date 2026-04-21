import { describe, it, expect } from "vitest";
import { buildCsv, escapeCsvField } from "./ReportsScreen.js";

// G05 — ReportsScreen CSV escape coverage (coverage-gaps-2026-04-18.md).
// Tests the pure CSV helpers extracted out of ReportsScreen.tsx.
//
// Scope:
//   - RFC 4180 quoting for `,` `"` `\n` `\r` `\r\n`.
//   - Null / undefined / empty passthrough.
//   - UTF-8 round-trip (₹, Devanagari, CJK).
//   - Excel/LibreOffice formula-injection neutralisation (leading
//     `=` `+` `-` `@` `\t` `\r`).
//   - Row terminator is CRLF.

describe("escapeCsvField — passthrough", () => {
  it("plain ASCII value passes through unmodified", () => {
    expect(escapeCsvField("hello")).toBe("hello");
  });

  it("numeric-as-string passes through unmodified", () => {
    expect(escapeCsvField("12345")).toBe("12345");
  });

  it("decimal money string passes through unmodified", () => {
    expect(escapeCsvField("1234.56")).toBe("1234.56");
  });

  it("empty string returns empty, no quoting", () => {
    expect(escapeCsvField("")).toBe("");
  });

  it("null returns empty, no quoting", () => {
    expect(escapeCsvField(null)).toBe("");
  });

  it("undefined returns empty, no quoting", () => {
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("number value coerces to string and passes through", () => {
    expect(escapeCsvField(42)).toBe("42");
  });

  it("boolean value coerces to string and passes through", () => {
    expect(escapeCsvField(true)).toBe("true");
  });
});

describe("escapeCsvField — RFC 4180 quoting", () => {
  it("comma in value → field wrapped in double-quotes", () => {
    expect(escapeCsvField("Paracetamol, 500mg")).toBe('"Paracetamol, 500mg"');
  });

  it('double-quote in value → `"` doubled to `""` and field quoted', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("only a double-quote → doubled and quoted", () => {
    expect(escapeCsvField('"')).toBe('""""');
  });

  it("LF in value → field quoted, LF preserved", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("CRLF in value → field quoted, CRLF preserved", () => {
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("bare CR in value → field quoted, CR preserved", () => {
    // Leading CR also triggers formula-injection prefix, so this case
    // uses a CR in the middle only.
    expect(escapeCsvField("a\rb")).toBe('"a\rb"');
  });

  it("comma + quote combination → quoted with internal quote doubled", () => {
    expect(escapeCsvField('foo, "bar"')).toBe('"foo, ""bar"""');
  });
});

describe("escapeCsvField — UTF-8 round-trip", () => {
  it("rupee sign passes through unmodified", () => {
    expect(escapeCsvField("Rs 1,200")).toBe('"Rs 1,200"');
    expect(escapeCsvField("₹1200")).toBe("₹1200");
  });

  it("Devanagari passes through unmodified", () => {
    expect(escapeCsvField("देवनागरी")).toBe("देवनागरी");
  });

  it("CJK Han passes through unmodified", () => {
    expect(escapeCsvField("汉字")).toBe("汉字");
  });

  it("emoji passes through unmodified", () => {
    expect(escapeCsvField("pill-💊")).toBe("pill-💊");
  });
});

describe("escapeCsvField — formula-injection neutralisation", () => {
  // Soft-S security review finding. Leading `=`, `+`, `-`, `@`, `\t`, `\r`
  // in a CSV cell is interpreted by Excel/LibreOffice as a formula,
  // allowing remote data exfiltration via `=WEBSERVICE(...)` or
  // equivalent. Fix: prefix with `'` (apostrophe), which Excel strips
  // silently on open and renders as literal text.

  it("leading `=` is prefixed with apostrophe", () => {
    expect(escapeCsvField("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
  });

  it("leading `+` is prefixed with apostrophe", () => {
    expect(escapeCsvField("+1234")).toBe("'+1234");
  });

  it("leading `-` is prefixed with apostrophe", () => {
    // Critical: negative-number strings look like formulas to Excel
    // (it treats `-SUM(...)` as a formula). Trade-off: genuine negative
    // money values also pick up the `'` prefix; downstream (CA tool, Tally)
    // must strip the apostrophe. Documented in helper JSDoc.
    expect(escapeCsvField("-500")).toBe("'-500");
  });

  it("leading `@` is prefixed with apostrophe", () => {
    expect(escapeCsvField("@cmd|'/c calc'!A1")).toBe("'@cmd|'/c calc'!A1");
  });

  it("leading `=` with a comma → prefix + quoting composed", () => {
    // Combined case: formula chars triggering quoting must land the `'`
    // inside the quoted span so the cell reads as literal text.
    expect(escapeCsvField("=HYPERLINK(\"http://x\",\"a\")")).toBe(
      '"\'=HYPERLINK(""http://x"",""a"")"',
    );
  });

  it("leading TAB is prefixed with apostrophe (DDE injection)", () => {
    expect(escapeCsvField("\tfoo")).toBe("'\tfoo");
  });

  it("leading CR triggers formula-injection prefix AND quoting", () => {
    // Leading `\r` hits both the formula-char regex and the quoting regex.
    // Result: `'` prepended, then the whole thing quoted.
    expect(escapeCsvField("\rfoo")).toBe('"\'\rfoo"');
  });

  it("`=` that is NOT leading is left alone", () => {
    expect(escapeCsvField("A=B")).toBe("A=B");
  });

  it("`-` that is NOT leading is left alone", () => {
    expect(escapeCsvField("A-B")).toBe("A-B");
  });

  it("`+` that is NOT leading is left alone", () => {
    expect(escapeCsvField("A+B")).toBe("A+B");
  });

  it("`@` that is NOT leading is left alone", () => {
    expect(escapeCsvField("user@example.com")).toBe("user@example.com");
  });
});

describe("buildCsv — row composition", () => {
  it("single row, plain values → comma-joined, no CRLF", () => {
    expect(buildCsv([["a", "b", "c"]])).toBe("a,b,c");
  });

  it("two rows → joined with CRLF row terminator", () => {
    expect(buildCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });

  it("empty fields preserve column count", () => {
    expect(buildCsv([["a", "", "c"]])).toBe("a,,c");
  });

  it("null / undefined fields render as empty", () => {
    expect(buildCsv([["a", null, undefined, "d"]])).toBe("a,,,d");
  });

  it("row with commas in one field → only that field is quoted", () => {
    expect(buildCsv([["plain", "has, comma", "also-plain"]])).toBe(
      'plain,"has, comma",also-plain',
    );
  });

  it("realistic day-book header + row round-trip", () => {
    const rows: readonly (readonly unknown[])[] = [
      ["Bill No", "Billed At", "Payment", "Gross (₹)", "Voided"],
      ["INV/2026/001", "2026-04-18T10:00:00Z", "CASH", "1234.56", "N"],
    ];
    const csv = buildCsv(rows);
    expect(csv).toBe(
      "Bill No,Billed At,Payment,Gross (₹),Voided\r\n" +
        "INV/2026/001,2026-04-18T10:00:00Z,CASH,1234.56,N",
    );
  });

  it("row with formula + utf-8 + newline mixed → fully escaped", () => {
    // Stress test: one row touching every escape rule.
    const rows = [
      ["=ATTACK()", "line1\nline2", "देवनागरी", '"q"', null, ""],
    ];
    expect(buildCsv(rows)).toBe(
      "'=ATTACK()," + // formula neutralisation, no quoting needed
        '"line1\nline2",' + // newline forces quoting
        "देवनागरी," + // UTF-8 passes through
        '"""q"""' + // quote doubled + wrapped
        ",,", // null + empty
    );
  });

  it("empty input → empty string", () => {
    expect(buildCsv([])).toBe("");
  });

  it("single empty row → empty string (no fields to join)", () => {
    expect(buildCsv([[]])).toBe("");
  });
});
