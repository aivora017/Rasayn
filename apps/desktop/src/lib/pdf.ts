// pdf.ts — Tiny PDF generator for plain monospace text.
//
// Avoids a runtime dep (jspdf adds ~150 KB to the bundle). For a one-page,
// monospace, plain-text PDF (cash-shift handover, simple receipts) we hand-
// craft a minimal PDF 1.4 file: 5 objects + Helvetica core font.
//
// Page = A4 (595 × 842 pt). Margins = 36 pt. Font = Helvetica 10 pt, leading 12 pt.
// Wraps long lines at ~70 cols. Caller passes plain text (newline-separated).

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 36;
const FONT_SIZE = 10;
const LEADING = 12;
const COL_MAX = 70;

function escapeText(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const out: string[] = [];
  let buf = "";
  for (const word of line.split(/(\s+)/)) {
    if ((buf + word).length > max && buf.length > 0) {
      out.push(buf.trimEnd());
      buf = word.trimStart();
    } else {
      buf += word;
    }
  }
  if (buf.length > 0) out.push(buf.trimEnd());
  return out.length === 0 ? [""] : out;
}

/** Build a minimal single-page PDF as a Blob. */
export function buildSimplePdf(title: string, body: string): Blob {
  const lines = body
    .split(/\r?\n/)
    .flatMap((ln) => wrap(ln, COL_MAX));

  // Build content stream: BT, Tf, Td, leading, T* lines, ET.
  const parts: string[] = [];
  parts.push("BT");
  parts.push(`/F1 ${FONT_SIZE} Tf`);
  parts.push(`${LEADING} TL`);
  parts.push(`${MARGIN} ${PAGE_H - MARGIN} Td`);
  // Title (bold-ish via repeated text isn't worth it; use slightly larger size for first line)
  parts.push(`(${escapeText(title)}) Tj`);
  parts.push("T*");
  parts.push("T*");
  for (const ln of lines) {
    parts.push(`(${escapeText(ln)}) Tj`);
    parts.push("T*");
  }
  parts.push("ET");
  const content = parts.join("\n");
  const contentBytes = new TextEncoder().encode(content);

  // Build the PDF as a series of indirect objects + xref + trailer.
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array) => { chunks.push(b); pos += b.length; };
  const pushStr = (s: string) => push(enc.encode(s));

  pushStr("%PDF-1.4\n%âãÏÓ\n");

  // 1: catalog
  offsets[1] = pos;
  pushStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // 2: pages
  offsets[2] = pos;
  pushStr("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  // 3: page
  offsets[3] = pos;
  pushStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
    `/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  );

  // 4: content stream
  offsets[4] = pos;
  pushStr(`4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  pushStr("\nendstream\nendobj\n");

  // 5: font
  offsets[5] = pos;
  pushStr("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");

  // xref
  const xrefStart = pos;
  pushStr(`xref\n0 6\n`);
  pushStr("0000000000 65535 f \n");
  for (let i = 1; i <= 5; i++) {
    pushStr(`${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`);
  }

  // trailer
  pushStr(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  // Concat
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new Blob([out], { type: "application/pdf" });
}

/** Trigger a download of the generated PDF. */
export function downloadPdf(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
