import { describe, expect, it } from "vitest";
import {
  csvTallyB2B, csvTallyB2CL, csvTallyB2CS, csvTallyHsn,
  csvTallyCdnr, csvTallyCdnur, stateName,
} from "./tallyCsv.js";
import type {
  B2BBuyerBlock, B2CLStateBlock, B2CSRow, HsnRow,
  CdnrBuyerBlock, CdnurNote,
} from "./types.js";

function lines(s: string): string[] { return s.replace(/\n$/, "").split("\n"); }

describe("stateName", () => {
  it("maps common state codes to Tally-friendly names", () => {
    expect(stateName("27")).toBe("Maharashtra");
    expect(stateName("07")).toBe("Delhi");
    expect(stateName("29")).toBe("Karnataka");
    expect(stateName("33")).toBe("Tamil Nadu");
  });
  it("returns the code unchanged for unknown values", () => {
    expect(stateName("99")).toBe("Other Country");
    expect(stateName("ZZ")).toBe("ZZ");
  });
});

describe("csvTallyB2B", () => {
  it("emits Tally-prime headers with state name (not code)", () => {
    const blk: B2BBuyerBlock = {
      ctin: "27AAAAA0000A1Z5",
      inv: [{
        inum: "INV-1", idt: "05/03/2026", val: 11200, pos: "27",
        rchrg: "N", inv_typ: "R",
        itms: [{ num: 1, itm_det: { txval: 100, rt: 12, iamt: 0, camt: 6, samt: 6, csamt: 0 } }],
      }],
    };
    const out = csvTallyB2B([blk]);
    const ls = lines(out);
    expect(ls[0]).toMatch(/^Voucher Date,Voucher No,Party GSTIN,Place of Supply,/);
    expect(ls[0]).toMatch(/Integrated Tax Amount,Central Tax Amount,State Tax Amount/);
    expect(ls[1]).toMatch(/^05\/03\/2026,INV-1,27AAAAA0000A1Z5,Maharashtra,No,Regular,12,100,/);
  });
});

describe("csvTallyB2CL", () => {
  it("renders state name + correct columns", () => {
    const blk: B2CLStateBlock = {
      pos: "07",
      inv: [{
        inum: "INV-INTER-1", idt: "08/03/2026", val: 280000,
        itms: [{ num: 1, itm_det: { txval: 250000, rt: 12, iamt: 30000, camt: 0, samt: 0, csamt: 0 } }],
      }],
    };
    const out = csvTallyB2CL([blk]);
    expect(out).toMatch(/Place of Supply/);
    expect(out).toMatch(/,Delhi,/);
    expect(out).toMatch(/,250000,30000,/);
  });
});

describe("csvTallyB2CS", () => {
  it("renders Type + state name", () => {
    const r: B2CSRow = {
      sply_ty: "INTRA", pos: "27", typ: "OE", rt: 12,
      txval: 100, iamt: 0, camt: 6, samt: 6, csamt: 0,
    };
    const out = csvTallyB2CS([r]);
    expect(out).toMatch(/^Type,Place of Supply,Rate/);
    expect(out).toMatch(/^Intra-State,Maharashtra,12,100,/m);
  });
  it("INTER → 'Inter-State'", () => {
    const r: B2CSRow = {
      sply_ty: "INTER", pos: "07", typ: "OE", rt: 18,
      txval: 200, iamt: 36, camt: 0, samt: 0, csamt: 0,
    };
    const out = csvTallyB2CS([r]);
    expect(out).toMatch(/Inter-State,Delhi/);
  });
});

describe("csvTallyHsn", () => {
  it("renders HSN columns", () => {
    const r: HsnRow = {
      num: 1, hsn_sc: "30049099", desc: "Crocin 500 Tab", uqc: "NOS",
      qty: 10, rt: 12, txval: 1000, iamt: 0, camt: 60, samt: 60, csamt: 0,
    };
    const out = csvTallyHsn([r]);
    expect(out).toMatch(/^HSN\/SAC,Description,UQC/);
    expect(out).toMatch(/30049099,Crocin 500 Tab,NOS,10,12,1000,/);
  });
});

describe("csvTallyCdnr", () => {
  it("emits credit-note rows with original-invoice ref", () => {
    const blk: CdnrBuyerBlock = {
      ctin: "27AAAAA0000A1Z5",
      nt: [{
        nt_num: "CN/2025-26/0001", nt_dt: "20/04/2026", val: 11.20, ntty: "C",
        inum: "INV-1", idt: "05/04/2026",
        itms: [{ num: 1, itm_det: { txval: 10, rt: 12, iamt: 0, camt: 0.60, samt: 0.60, csamt: 0 } }],
      }],
    };
    const out = csvTallyCdnr([blk]);
    expect(out).toMatch(/Note Type,Party GSTIN,Original Invoice No/);
    expect(out).toMatch(/Credit Note,27AAAAA0000A1Z5,INV-1,05\/04\/2026/);
  });
});

describe("csvTallyCdnur", () => {
  it("emits CDNUR with state-name pos + Original Type", () => {
    const n: CdnurNote = {
      nt_num: "CN/2025-26/0099", nt_dt: "20/04/2026", val: 280000,
      ntty: "C", typ: "B2CL", inum: "INV-INTER-1", idt: "08/03/2026",
      pos: "07",
      itms: [{ num: 1, itm_det: { txval: 250000, rt: 12, iamt: 30000, camt: 0, samt: 0, csamt: 0 } }],
    };
    const out = csvTallyCdnur([n]);
    expect(out).toMatch(/Original Type,Place of Supply/);
    expect(out).toMatch(/B2CL,Delhi/);
  });
});

describe("Tally CSV — empty input → header only", () => {
  it.each([
    ["B2B", csvTallyB2B],
    ["B2CL", csvTallyB2CL],
    ["B2CS", csvTallyB2CS],
    ["HSN", csvTallyHsn],
    ["CDNR", csvTallyCdnr],
    ["CDNUR", csvTallyCdnur],
  ])("%s emits header-only on empty", (_name, fn) => {
    const out = (fn as (x: unknown[]) => string)([]);
    expect(lines(out).length).toBe(1);
  });
});
