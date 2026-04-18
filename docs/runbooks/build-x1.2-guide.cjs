/* eslint-disable */
// Self-contained DOCX builder for the X1.2 operator runbook.
// No npm deps - uses Node built-ins only (fs, zlib, path).
// Run:  node docs/runbooks/build-x1.2-guide.cjs
// Output: docs/runbooks/x1.2-gmail-to-grn-operator-guide.docx

"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---------- tiny minimal ZIP writer (store + deflate), no ZIP64 ----------
// CRC-32 table
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

function zipArchive(entries) {
  // entries: [{ name, data (Buffer), deflate: bool }]
  const parts = [];
  const central = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = 0x21; // 1980-01-01
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const raw = e.data;
    const crc = crc32(raw);
    const uncSize = raw.length;
    let stored;
    let method;
    if (e.deflate) {
      stored = zlib.deflateRawSync(raw, { level: 9 });
      method = 8;
    } else {
      stored = raw;
      method = 0;
    }
    const compSize = stored.length;
    // Local file header
    const lfh = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(method),
      u16(dosTime), u16(dosDate),
      u32(crc), u32(compSize), u32(uncSize),
      u16(nameBuf.length), u16(0),
      nameBuf,
    ]);
    parts.push(lfh, stored);
    // Central dir entry
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method),
      u16(dosTime), u16(dosDate),
      u32(crc), u32(compSize), u32(uncSize),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBuf,
    ]));
    offset += lfh.length + stored.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(central);
  const cdSize = cd.length;
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(cdSize), u32(cdStart), u16(0),
  ]);
  return Buffer.concat([...parts, cd, eocd]);
}

// ---------- WordprocessingML helpers ----------
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Paragraph: { text, style?, bold?, italic?, size?, align?, list?, runs?, pageBreakBefore?, border? }
function para(p) {
  const pPr = [];
  if (p.pageBreakBefore) pPr.push(`<w:pageBreakBefore/>`);
  if (p.style) pPr.push(`<w:pStyle w:val="${p.style}"/>`);
  if (p.list === "bullet") {
    pPr.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`);
  } else if (p.list === "number") {
    pPr.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>`);
  }
  if (p.align) pPr.push(`<w:jc w:val="${p.align}"/>`);
  if (p.spacingBefore || p.spacingAfter) {
    pPr.push(`<w:spacing w:before="${p.spacingBefore||0}" w:after="${p.spacingAfter||0}"/>`);
  }
  if (p.border) {
    pPr.push(`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="2E75B6"/></w:pBdr>`);
  }
  const pPrXml = pPr.length ? `<w:pPr>${pPr.join("")}</w:pPr>` : "";
  let runsXml = "";
  if (p.runs && p.runs.length) {
    for (const r of p.runs) runsXml += run(r);
  } else if (p.text !== undefined) {
    runsXml = run({ text: p.text, bold: p.bold, italic: p.italic, size: p.size, color: p.color });
  }
  return `<w:p>${pPrXml}${runsXml}</w:p>`;
}

function run(r) {
  const rPr = [];
  if (r.bold) rPr.push(`<w:b/>`);
  if (r.italic) rPr.push(`<w:i/>`);
  if (r.size) rPr.push(`<w:sz w:val="${r.size}"/>`);
  if (r.color) rPr.push(`<w:color w:val="${r.color}"/>`);
  if (r.font) rPr.push(`<w:rFonts w:ascii="${r.font}" w:hAnsi="${r.font}"/>`);
  const rPrXml = rPr.length ? `<w:rPr>${rPr.join("")}</w:rPr>` : "";
  const text = r.text === undefined ? "" : r.text;
  const preserve = /^\s|\s$/.test(text) ? ` xml:space="preserve"` : "";
  return `<w:r>${rPrXml}<w:t${preserve}>${esc(text)}</w:t></w:r>`;
}

function cell(contents, opts = {}) {
  const widthDxa = opts.width || 3120;
  const shading = opts.shading
    ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shading}"/>`
    : "";
  const tcPr = `<w:tcPr><w:tcW w:w="${widthDxa}" w:type="dxa"/>${shading}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr>`;
  return `<w:tc>${tcPr}${contents}</w:tc>`;
}

function table(rows, colWidths) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const grid = colWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  const tblPr = `<w:tblPr><w:tblW w:w="${totalW}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideH w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideV w:val="single" w:sz="4" w:color="CCCCCC"/></w:tblBorders></w:tblPr>`;
  return `<w:tbl>${tblPr}<w:tblGrid>${grid}</w:tblGrid>${rows.join("")}</w:tbl>`;
}

function tRow(cells) {
  return `<w:tr>${cells.join("")}</w:tr>`;
}

// ---------- content ----------
const children = [];

// ---- Cover page ----
children.push(para({ text: "", spacingBefore: 3600 }));
children.push(para({
  align: "center",
  runs: [{ text: "X1.2 Gmail to GRN", bold: true, size: 56, font: "Arial", color: "1F3864" }],
}));
children.push(para({
  align: "center",
  runs: [{ text: "Operator Guide", bold: true, size: 40, font: "Arial", color: "1F3864" }],
  spacingAfter: 240,
}));
children.push(para({
  align: "center", border: true,
  runs: [{ text: " ", size: 2 }],
}));
children.push(para({
  align: "center",
  runs: [{ text: "Version 1.0", size: 28, font: "Arial" }],
  spacingBefore: 240,
}));
children.push(para({
  align: "center",
  runs: [{ text: "2026-04-18", size: 28, font: "Arial" }],
}));
children.push(para({
  align: "center",
  runs: [{ text: "For PharmaCare Pro X1.2", size: 28, font: "Arial", italic: true }],
  spacingAfter: 400,
}));
children.push(para({
  align: "center",
  runs: [{
    text: "Turn distributor-bill emails into stocked GRNs in seconds, without retyping a single line.",
    size: 26, font: "Arial", italic: true, color: "404040",
  }],
}));
// page break after cover
children.push(para({ pageBreakBefore: true }));

// ---- Section 1 ----
children.push(para({ style: "Heading1", runs: [{ text: "1. What this feature does for you", bold: true, size: 36, font: "Arial" }] }));

children.push(para({
  runs: [{
    text: "Every week your distributors email you PDF or Excel invoices. Until now, someone in your shop had to open each email, read the bill, search every product by name in PharmaCare Pro, type the batch number and expiry by hand, then save the receipt. On a busy morning, a 40-line bill can eat an hour. This feature removes that hour.",
    size: 24, font: "Arial",
  }],
  spacingAfter: 140,
}));
children.push(para({
  runs: [{
    text: "X1.2 reads the distributor bill directly from your Gmail inbox. It pulls out each product, matches it against your product master, and drops the matched lines into a Goods Receipt Note (GRN = the receipt you save when stock arrives) ready for you to confirm. You keep full control: the computer only auto-fills lines it is confident about, and anything it is unsure of stays on screen for you to decide.",
    size: 24, font: "Arial",
  }],
  spacingAfter: 140,
}));
children.push(para({
  runs: [{
    text: "You still do the human part: check the batch number, confirm the expiry date, and press Save. Stock goes up immediately. FEFO (First-Expiry-First-Out) is respected automatically, so when you bill a patient tomorrow, the oldest-expiring stock goes out first.",
    size: 24, font: "Arial",
  }],
}));

// ---- Section 2 ----
children.push(para({ style: "Heading1", pageBreakBefore: true, runs: [{ text: "2. One-time setup: connect your Gmail", bold: true, size: 36, font: "Arial" }] }));
children.push(para({ runs: [{ text: "You only do this once per shop computer. It takes about a minute.", size: 24, font: "Arial" }], spacingAfter: 140 }));

const setupSteps = [
  "Open PharmaCare Pro on your shop computer.",
  "Press Alt+8 to open the Settings screen.",
  "Find the section called Gmail Integration.",
  "Click the Connect Gmail button. Your web browser will open to a Google sign-in page.",
  "Sign in with the Gmail account your distributors send bills to. Use the shop email, not a personal one.",
  "Google will ask permission to let PharmaCare Pro read your email. Click Allow. PharmaCare Pro only asks for read-only access. It cannot send, delete, or reply.",
  "The browser tab will show Success. Go back to PharmaCare Pro. You will see Connected as [your email] in green.",
  "Done. You will not need to do this again on this computer.",
];
setupSteps.forEach((s) => children.push(para({ list: "number", runs: [{ text: s, size: 24, font: "Arial" }] })));
children.push(para({ runs: [{ text: "[SCREENSHOT: Settings screen showing the Gmail Integration panel with the Connect Gmail button]", italic: true, color: "808080", size: 22, font: "Arial" }], spacingBefore: 120 }));
children.push(para({ runs: [{ text: "[SCREENSHOT: Google consent screen with PharmaCare Pro requesting read-only Gmail access]", italic: true, color: "808080", size: 22, font: "Arial" }] }));
children.push(para({ runs: [{ text: "[SCREENSHOT: Gmail Integration panel after connection showing the green Connected status and your email address]", italic: true, color: "808080", size: 22, font: "Arial" }], spacingAfter: 120 }));
children.push(para({
  runs: [
    { text: "Tip: ", bold: true, size: 24, font: "Arial" },
    { text: "if the browser does not open, check that your default browser is set in Windows. Chrome and Edge both work.", size: 24, font: "Arial" },
  ],
}));

// ---- Section 3 ----
children.push(para({ style: "Heading1", pageBreakBefore: true, runs: [{ text: "3. Creating a supplier template", bold: true, size: 36, font: "Arial" }] }));
children.push(para({ runs: [{ text: "A supplier template tells PharmaCare Pro how to read one distributor's bill format. For example, Cipla's invoice lays out columns differently from Sun Pharma's. You make one template per distributor you buy from. Each template is a small rule set: where the invoice number is, where the product name starts, where batch and expiry appear. You do this once per distributor and never again.", size: 24, font: "Arial" }], spacingAfter: 140 }));

const tplSteps = [
  "Press Alt+6 to open the Templates screen.",
  "Click Add Template. Give it a clear name like Cipla-2026 or KalyanMedical-Standard.",
  "Paste a sample of one distributor bill's plain text into the sample box. The easiest source: open a recent email from that distributor, copy the invoice text, paste it in.",
  "Mark the columns: Product name, Batch #, Expiry, Quantity, Rate, MRP. The template editor will highlight where it thinks each one is. Correct it if wrong.",
  "Click Test. You should see the parsed lines below.",
  "If the line count and values look right, click Save.",
  "Repeat for every distributor you use. Most shops have 4 to 8 templates total.",
];
tplSteps.forEach((s) => children.push(para({ list: "number", runs: [{ text: s, size: 24, font: "Arial" }] })));
children.push(para({ runs: [{ text: "[SCREENSHOT: Templates screen with a list of supplier templates on the left]", italic: true, color: "808080", size: 22, font: "Arial" }], spacingBefore: 120 }));
children.push(para({ runs: [{ text: "[SCREENSHOT: Template editor with a pasted sample bill and highlighted column ranges]", italic: true, color: "808080", size: 22, font: "Arial" }] }));
children.push(para({ runs: [{ text: "[SCREENSHOT: Test output showing parsed lines with Product, Batch, Expiry, Qty, Rate columns]", italic: true, color: "808080", size: 22, font: "Arial" }], spacingAfter: 140 }));
children.push(para({ runs: [{ text: "You can also pick Auto-detect template in step 5 of the daily workflow. It works when we already know the distributor's layout. If auto-detect fails, fall back to a manual template.", size: 24, font: "Arial", italic: true }] }));

// ---- Section 4 ----
children.push(para({ style: "Heading1", pageBreakBefore: true, runs: [{ text: "4. Daily workflow: bill to stock in one minute", bold: true, size: 36, font: "Arial" }] }));
children.push(para({ runs: [{ text: "This is the flow you will run every time a new distributor bill lands in your Gmail. Start from any screen.", size: 24, font: "Arial" }], spacingAfter: 140 }));

const dailySteps = [
  "Press Alt+7 to open the Gmail Inbox screen in PharmaCare Pro. The title at the top says Gmail connection.",
  "If this is your first time today, click Fetch to load the last 30 days of emails with attachments. The list will fill up with subject, sender, date, and attachment filename.",
  "Click the message you want to import. The right-hand panel loads the invoice text automatically. If the PDF could not be read as text, paste the invoice text into the box yourself.",
  "From the Template dropdown, pick the supplier template that matches this distributor. If you have not made one yet, see Section 3.",
  "Click Parse. You will see Invoice no, Invoice date, and Line count. Below that, a small table of parsed products appears.",
  "If the numbers look right, click Send to GRN (F4). PharmaCare Pro jumps to the Receive screen (Alt+4) and a blue banner appears at the top saying Imported from Gmail.",
  "Watch the banner. For each parsed line, a match badge appears: high, medium, low, or no match. Green-high and amber-medium lines automatically appear in the main receipt table below. Red-low and no-match lines stay in the banner for you to handle.",
  "For each low or no-match line: click Skip if it is something you do not stock, or use the product search at the top of the main table to find and add the right product manually.",
  "In the main receipt table, fill in Batch # and Expiry for every auto-appended line. These are not always in the PDF, so you usually type them from the physical goods in front of you.",
  "Check Cost and MRP columns. Correct any value that does not match the printed bill.",
  "Press F9 to save the GRN. A green toast appears: Saved GRN x batches. Stock is now live.",
  "Dismiss the banner by clicking Dismiss on its right side, or leave it while you save the next bill.",
];
dailySteps.forEach((s) => children.push(para({ list: "number", runs: [{ text: s, size: 24, font: "Arial" }] })));
children.push(para({ runs: [{ text: "[SCREENSHOT: Gmail Inbox screen with message list on the left and parse panel on the right]", italic: true, color: "808080", size: 22, font: "Arial" }], spacingBefore: 120 }));
children.push(para({ runs: [{ text: "[SCREENSHOT: Parsed lines preview inside the Gmail Inbox screen]", italic: true, color: "808080", size: 22, font: "Arial" }] }));
children.push(para({ runs: [{ text: "[SCREENSHOT: GRN screen showing the blue Imported from Gmail banner with match badges]", italic: true, color: "808080", size: 22, font: "Arial" }] }));
children.push(para({ runs: [{ text: "[SCREENSHOT: Main GRN table with auto-appended rows and empty Batch/Expiry fields ready for the operator]", italic: true, color: "808080", size: 22, font: "Arial" }] }));
children.push(para({ runs: [{ text: "[SCREENSHOT: Green Saved GRN toast in the lower right after pressing F9]", italic: true, color: "808080", size: 22, font: "Arial" }], spacingAfter: 140 }));
children.push(para({
  runs: [
    { text: "Keyboard shortcuts that matter here: ", bold: true, size: 24, font: "Arial" },
    { text: "Alt+7 (Gmail Inbox), Alt+4 (Receive/GRN), F4 inside Gmail Inbox (Send to GRN), F9 inside GRN (Save).", size: 24, font: "Arial" },
  ],
}));

// ---- Section 5: match column table ----
children.push(para({ style: "Heading1", pageBreakBefore: true, runs: [{ text: "5. Understanding the match column", bold: true, size: 36, font: "Arial" }] }));
children.push(para({ runs: [{ text: "When a parsed line arrives at the GRN screen, the computer compares the distributor's product name against your product master and decides how confident it is. That confidence becomes the Match badge you see in the banner. Here is exactly what each badge means and what you should do.", size: 24, font: "Arial" }], spacingAfter: 160 }));

const cw = [1700, 3260, 4400];
const hdr = tRow([
  cell(para({ runs: [{ text: "Badge", bold: true, size: 22, font: "Arial" }] }), { width: cw[0], shading: "D5E8F0" }),
  cell(para({ runs: [{ text: "What it means", bold: true, size: 22, font: "Arial" }] }), { width: cw[1], shading: "D5E8F0" }),
  cell(para({ runs: [{ text: "What you should do", bold: true, size: 22, font: "Arial" }] }), { width: cw[2], shading: "D5E8F0" }),
]);
const rows = [
  ["high",
    "Confidence 0.80 or above. The bill product name matches one of your product master entries almost perfectly, or the HSN + name agree strongly.",
    "Nothing. The line has been auto-added to your receipt below. Just type the batch number and expiry like normal."],
  ["medium",
    "Confidence between 0.50 and 0.79. The computer found a likely match by word overlap but not an exact match. Often this is the right product in a slightly different pack size or strength.",
    "Look at the product name shown next to the badge. If it is right, proceed. If it is the wrong strength or pack, remove that auto-added row from the main table and add the correct product using the search box."],
  ["low",
    "Confidence under 0.50. The computer found something that matches a few words but not enough to trust.",
    "The line is NOT added automatically. In the banner, either click Skip (if you do not stock this) or use the product search in the main table to add the right product by hand."],
  ["no match",
    "The computer could not find any product in your master that looks like this line.",
    "Usually means a new SKU. Either click Skip (and decide later) or add the matching product via search if you stock something equivalent. A future release will let you create a new product inline."],
  ["skipped",
    "You clicked Skip on this line. It will not become stock.",
    "If you skipped by mistake, re-import the email. The banner will repopulate."],
  ["pending",
    "Shown as three dots while the computer is still looking up candidates. Very brief.",
    "Wait one moment. The badge will settle on one of the above."],
];
const bodyRows = rows.map(([a, b, c]) => tRow([
  cell(para({ runs: [{ text: a, bold: true, size: 22, font: "Arial" }] }), { width: cw[0] }),
  cell(para({ runs: [{ text: b, size: 22, font: "Arial" }] }), { width: cw[1] }),
  cell(para({ runs: [{ text: c, size: 22, font: "Arial" }] }), { width: cw[2] }),
]));
children.push({ raw: table([hdr, ...bodyRows], cw) });

children.push(para({ runs: [{ text: "The confidence thresholds are fixed in software: high is anything at or above 0.80, medium is 0.50 to 0.79, low is below 0.50. You cannot change them. This is deliberate. The goal is that you never second-guess the badge.", size: 24, font: "Arial", italic: true }], spacingBefore: 160 }));

// ---- Section 6 troubleshooting ----
children.push(para({ style: "Heading1", pageBreakBefore: true, runs: [{ text: "6. When things go wrong", bold: true, size: 36, font: "Arial" }] }));

const tw = [3600, 5760];
const thdr = tRow([
  cell(para({ runs: [{ text: "Problem", bold: true, size: 22, font: "Arial" }] }), { width: tw[0], shading: "FDE9D9" }),
  cell(para({ runs: [{ text: "What to try", bold: true, size: 22, font: "Arial" }] }), { width: tw[1], shading: "FDE9D9" }),
]);
const trows = [
  ["Connect Gmail button does nothing.",
    "Your default browser may not be set. Open Windows Settings, Apps, Default apps, and set Chrome or Edge as the default. Then click Connect again."],
  ["Status says Not connected even after I signed in.",
    "Click Disconnect and then Connect Gmail again. If it keeps failing, check that the computer has internet. Then contact Sourav."],
  ["Fetch loads no messages.",
    "Check the query box. The default is has:attachment newer_than:30d. Make sure at least one email in the last 30 days has an attachment. You can widen the search by changing 30d to 60d."],
  ["I clicked a message but the parse box is empty.",
    "The PDF was not text-searchable. Open the email manually, copy the invoice text, and paste it into the box below the template dropdown, then click Parse."],
  ["Parse shows Line count 0.",
    "Wrong template. Try a different supplier template or pick Auto-detect. If still zero, the bill format is new to PharmaCare Pro and needs a fresh template (Section 3)."],
  ["Send to GRN button is grey.",
    "Parse must return at least one line. Parse the bill first. If parse returned zero lines, the button stays disabled."],
  ["In GRN, a high-confidence line has the wrong product.",
    "Click the red X on that row to remove it. Then use the search box at the top of the table to pick the correct product. Please also tell Sourav - this should be rare."],
  ["F9 is not saving the GRN.",
    "Every row needs Batch #, Mfg date, Expiry, Qty > 0 and MRP > 0. Invoice # must be filled. Expiry must be after Mfg. The Save button stays grey until all of these are correct."],
  ["The same bill got imported twice.",
    "Save only the second one by dismissing the first banner first. A future release will warn you about duplicates by invoice number."],
  ["Stock looks wrong after I saved.",
    "Open Inventory (Alt+2) and search the product. Check the latest batch. If quantity is still wrong, go to Reports (Alt+3) and run the Stock Reconcile report to see the last 10 movements."],
];
const tbodyRows = trows.map(([a, b]) => tRow([
  cell(para({ runs: [{ text: a, size: 22, font: "Arial" }] }), { width: tw[0] }),
  cell(para({ runs: [{ text: b, size: 22, font: "Arial" }] }), { width: tw[1] }),
]));
children.push({ raw: table([thdr, ...tbodyRows], tw) });

// ---- Section 7 ----
children.push(para({ style: "Heading1", pageBreakBefore: true, runs: [{ text: "7. Privacy and security", bold: true, size: 36, font: "Arial" }] }));
children.push(para({ runs: [{ text: "This feature was designed with one principle: your distributor data never leaves your shop's computer.", size: 24, font: "Arial", bold: true }], spacingAfter: 140 }));

[
  "Gmail access is read-only. PharmaCare Pro asks Google for the minimum scope that lets it read email subjects and attachments. It cannot send email, reply, delete, mark as read, or change labels. If a staff member logs into Gmail on the web while PharmaCare Pro is running, nothing about their session changes.",
  "Your Gmail access token is stored encrypted on this computer only. It is not uploaded to any server. It is not shared with other PharmaCare Pro installations. If you move to a new computer, you connect Gmail again from scratch.",
  "Invoice parsing runs fully on your computer. The text of your bills is not sent to any cloud service. The matching algorithm is a plain rules-based comparison written in TypeScript, running inside the PharmaCare Pro desktop app. No AI cloud is called for X1.2.",
  "Your product master and stock ledger stay in your local SQLite database, as always. Nothing about this feature changes where your data lives.",
  "If you disconnect Gmail (Settings, Alt+8, Disconnect), the stored token is deleted from your computer immediately. You can reconnect any time.",
].forEach((t) => children.push(para({ list: "bullet", runs: [{ text: t, size: 24, font: "Arial" }] })));
children.push(para({ runs: [{ text: "If you ever want written confirmation of what scopes are being used, the Settings screen shows the active scope string under the connected email.", size: 24, font: "Arial", italic: true }], spacingBefore: 160 }));

// ---- Section 8: FAQ ----
children.push(para({ style: "Heading1", pageBreakBefore: true, runs: [{ text: "8. Frequently asked questions", bold: true, size: 36, font: "Arial" }] }));

const faqs = [
  ["Do I need an internet connection to save a GRN?",
    "Only to fetch the email. Once the bill is parsed and on screen, you can unplug the internet and still save. Stock goes into the local database."],
  ["Can two people in my shop use this at the same time?",
    "Yes, but each computer needs its own Gmail connection. We recommend one shop email shared across both computers."],
  ["What if the distributor emails a handwritten or scanned PDF?",
    "X1.2 reads machine-printed text only. For scanned paper bills, you still type them manually in the Receive screen. A future release (X1.4) will add image-based reading for scans."],
  ["The same product has two names on two different distributor bills. What happens?",
    "As long as both names share enough words, the bridge will match them to your single master product. If one is very different, it will show as low or no match and you map it manually once. Future releases will remember your mapping per distributor."],
  ["What if the bill has a product I do not stock yet?",
    "It will show up as no match. Click Skip in the banner. In the next release (X1.3), you will get a Create product button that opens the master with fields pre-filled from the bill."],
  ["Does this work with WhatsApp bills or SMS bills?",
    "Not today. Only Gmail. If your distributor sends via a different email provider, forward those messages into your Gmail and they will show up in the inbox list."],
  ["Can I undo a saved GRN?",
    "Open Reports (Alt+3), find the GRN by invoice number, and use Reverse GRN. This creates a compensating stock movement. Original record stays for audit."],
];
faqs.forEach(([q, a]) => {
  children.push(para({ runs: [{ text: "Q. " + q, bold: true, size: 24, font: "Arial" }], spacingBefore: 120 }));
  children.push(para({ runs: [{ text: "A. " + a, size: 24, font: "Arial" }] }));
});

// ---- Section 9: Getting help ----
children.push(para({ style: "Heading1", pageBreakBefore: true, runs: [{ text: "9. Getting help", bold: true, size: 36, font: "Arial" }] }));
children.push(para({ runs: [{ text: "Product and technical support comes from Sourav Shaw (developer, PharmaCare Pro).", size: 24, font: "Arial" }], spacingAfter: 140 }));
children.push(para({ runs: [
  { text: "Phone: ", bold: true, size: 24, font: "Arial" },
  { text: "[to be filled in by Sourav before distribution]", size: 24, font: "Arial" },
] }));
children.push(para({ runs: [
  { text: "Email: ", bold: true, size: 24, font: "Arial" },
  { text: "souravshawoffice@gmail.com", size: 24, font: "Arial" },
] }));
children.push(para({ runs: [
  { text: "Best time to call: ", bold: true, size: 24, font: "Arial" },
  { text: "Monday to Saturday, 10 AM to 7 PM IST.", size: 24, font: "Arial" },
] }));
children.push(para({ runs: [{ text: "", size: 12 }], spacingBefore: 200 }));
children.push(para({ runs: [{ text: "When you call or email, please keep ready: ", size: 24, font: "Arial", bold: true }] }));
[
  "The exact error message on screen (take a photo with your phone).",
  "The distributor name and invoice number you were trying to import.",
  "What you clicked just before the problem happened.",
  "Your PharmaCare Pro version, visible at the bottom of the screen as backend vX.Y.Z.",
].forEach((t) => children.push(para({ list: "bullet", runs: [{ text: t, size: 24, font: "Arial" }] })));
children.push(para({ runs: [{ text: "", size: 12 }], spacingBefore: 240 }));
children.push(para({ runs: [{ text: "A note on language: this guide is in English for version 1.0. Hindi and Marathi translations are planned and will arrive in a later release. If you have trouble with any term, please ask Sourav directly.", size: 22, font: "Arial", italic: true, color: "606060" }] }));

// ---- assemble document.xml ----
function serializeChildren(arr) {
  return arr.map((c) => (typeof c === "string" ? c : c.raw !== undefined ? c.raw : c)).join("");
}
const bodyXml = serializeChildren(children);

const documentXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${bodyXml}
<w:sectPr>
<w:headerReference w:type="default" r:id="rId10" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
<w:footerReference w:type="default" r:id="rId11" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
<w:pgSz w:w="12240" w:h="15840"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
<w:cols w:space="720"/>
<w:docGrid w:linePitch="360"/>
</w:sectPr>
</w:body>
</w:document>`;

const stylesXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:spacing w:before="320" w:after="200"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="1F3864"/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="160"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>`;

const numberingXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#x2022;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const headerXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/><w:color w:val="808080"/></w:rPr><w:t>PharmaCare Pro - X1.2 Operator Guide</w:t></w:r></w:p>
</w:hdr>`;

const footerXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="808080"/></w:rPr><w:t xml:space="preserve">v1.0 - 2026-04-18 - PharmaCare Pro X1.2     Page </w:t></w:r><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="808080"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="808080"/></w:rPr><w:instrText xml:space="preserve">PAGE</w:instrText></w:r><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="808080"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p>
</w:ftr>`;

const contentTypesXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

const rootRelsXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const docRelsXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

const entries = [
  { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8"), deflate: true },
  { name: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8"), deflate: true },
  { name: "word/_rels/document.xml.rels", data: Buffer.from(docRelsXml, "utf8"), deflate: true },
  { name: "word/document.xml", data: Buffer.from(documentXml, "utf8"), deflate: true },
  { name: "word/styles.xml", data: Buffer.from(stylesXml, "utf8"), deflate: true },
  { name: "word/numbering.xml", data: Buffer.from(numberingXml, "utf8"), deflate: true },
  { name: "word/header1.xml", data: Buffer.from(headerXml, "utf8"), deflate: true },
  { name: "word/footer1.xml", data: Buffer.from(footerXml, "utf8"), deflate: true },
];

const outBuf = zipArchive(entries);
const outPath = path.join(__dirname, "x1.2-gmail-to-grn-operator-guide.docx");
fs.writeFileSync(outPath, outBuf);
console.log("wrote", outPath, outBuf.length, "bytes");
