// DataExportScreen — full DB dump for migration-OUT (anti-vendor-lock-in).

import { useCallback, useState } from "react";
import { Download, ShieldCheck, FileDown, Loader2, AlertCircle } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import { paise } from "@pharmacare/shared-types";
import {
  buildDataExport,
  type FullDataExport, type DataExportBundle,
} from "@pharmacare/data-export";

function downloadBlob(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Demo data — production wires to RPCs over the live SQLite DB
function loadDemoFullData(): FullDataExport {
  return {
    shopName: "Jagannath Pharmacy LLP",
    shopGstin: "27AAAAA0000A1Z5",
    exportedAt: new Date().toISOString(),
    customers: [
      { id: "c1", name: "Asha Iyer", phone: "9876543210", currentDuePaise: paise(50000), createdAt: "2026-01-15" },
      { id: "c2", name: "Rajesh Kumar", phone: "9999988888", gstin: "27ZZZZ1234A1Z5", currentDuePaise: paise(0), createdAt: "2026-02-01" },
    ],
    products: [
      { id: "p1", name: "Crocin 500mg", genericName: "Paracetamol", manufacturer: "GSK", schedule: "H", hsn: "30049099", gstRatePct: 5, mrpPaise: paise(4500), isActive: true },
      { id: "p2", name: "Amoxicillin 500mg", genericName: "Amoxicillin", manufacturer: "Cipla", schedule: "H", hsn: "30049099", gstRatePct: 5, mrpPaise: paise(12000), isActive: true },
    ],
    batches: [
      { id: "b1", productId: "p1", batchNo: "BN-CRO-23", expiryDate: "2027-04-30", mrpPaise: paise(4500), purchasePricePaise: paise(3500), qtyOnHand: 150 },
    ],
    bills: [
      { id: "bill1", billNo: "B-001", billedAt: "2026-04-15T11:00:00Z", customerId: "c1", subtotalPaise: paise(10000), cgstPaise: paise(250), sgstPaise: paise(250), igstPaise: paise(0), cessPaise: paise(0), grandTotalPaise: paise(10500), paymentMode: "cash", cashierId: "u1", isVoided: false },
    ],
    billLines: [
      { id: "bl1", billId: "bill1", productId: "p1", batchId: "b1", qty: 2, mrpPaise: paise(4500), discountPct: 0, taxablePaise: paise(9000), taxPaise: paise(450), totalPaise: paise(9450) },
    ],
    payments: [
      { id: "pay1", billId: "bill1", mode: "cash", amountPaise: paise(10500) },
    ],
    grns: [
      { id: "g1", invoiceNo: "INV-101", invoiceDate: "2026-04-10", supplierId: "s1", supplierName: "Pharmarack", totalCostPaise: paise(50000), status: "received" },
    ],
    stockMovements: [
      { id: "sm1", batchId: "b1", productId: "p1", qtyDelta: 150, movementType: "grn", refTable: "grns", refId: "g1", actorId: "u1", createdAt: "2026-04-10T09:00:00Z" },
    ],
  };
}

// Reuse the hand-rolled ZIP from CAExportScreen
function buildZip(files: ReadonlyArray<{ name: string; content: string }>): Uint8Array {
  const enc = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let offset = 0; let centralSize = 0;
  function crc32(bytes: Uint8Array): number {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      c ^= bytes[i]!;
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.content);
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const dv = new DataView(localHeader.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, dataBytes.length, true); dv.setUint32(22, dataBytes.length, true);
    dv.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30); localHeader.set(dataBytes, 30 + nameBytes.length);
    localHeaders.push(localHeader);
    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true); cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, dataBytes.length, true); cdv.setUint32(24, dataBytes.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralEntries.push(central);
    offset += localHeader.length; centralSize += central.length;
  }
  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, files.length, true); dv.setUint16(10, files.length, true);
  dv.setUint32(12, centralSize, true); dv.setUint32(16, offset, true);
  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const lh of localHeaders) { out.set(lh, pos); pos += lh.length; }
  for (const ce of centralEntries) { out.set(ce, pos); pos += ce.length; }
  out.set(eocd, pos);
  return out;
}

export default function DataExportScreen(): React.ReactElement {
  const [bundle, setBundle] = useState<DataExportBundle | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = useCallback(() => {
    setBusy(true);
    try {
      const data = loadDemoFullData();
      setBundle(buildDataExport({ shopName: data.shopName, shopGstin: data.shopGstin, data }));
    } finally { setBusy(false); }
  }, []);

  const downloadAll = useCallback(() => {
    if (!bundle) return;
    const bytes = buildZip(bundle.files);
    const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `pharmacare_export_${new Date().toISOString().slice(0, 10)}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [bundle]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="data-export">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileDown size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Export everything</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Full data dump · YOUR data, no DRM · take it anywhere
            </p>
          </div>
        </div>
        <Badge variant="success"><ShieldCheck size={10} /> No vendor lock-in</Badge>
      </header>

      <Glass>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <ShieldCheck size={24} className="text-[var(--pc-brand-primary)] mt-1" />
            <div>
              <h2 className="font-semibold text-[15px]">PharmaCare's anti-lock-in promise</h2>
              <p className="text-[13px] text-[var(--pc-text-secondary)] mt-1">
                One click and you walk away with everything: customers, products, batches, every bill, every payment,
                every stock movement. CSV + JSON + re-import packs for Marg / Vyapar / Tally. We even tell you how to import into them.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={generate} disabled={busy}>
              {busy ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><Download size={14} /> Generate full export</>}
            </Button>
          </div>
        </div>
      </Glass>

      {bundle && (
        <>
          <Glass>
            <div className="p-4 flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-[16px]">Export ready · {bundle.files.length} files</h2>
                <p className="text-[12px] text-[var(--pc-text-secondary)] mt-1">
                  Download the ZIP, save it to USB or email it to yourself. You can re-import into PharmaCare anytime — or move to another vendor.
                </p>
              </div>
              <Button onClick={downloadAll}><Download size={14} /> Download ZIP</Button>
            </div>
          </Glass>

          <Glass>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                    <th className="py-2 font-medium">File</th>
                    <th className="py-2 font-medium text-right">Size</th>
                    <th className="py-2 font-medium text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.files.map((f) => (
                    <tr key={f.name} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                      <td className="py-2 font-mono">{f.name}</td>
                      <td className="py-2 font-mono tabular-nums text-right">{(f.content.length / 1024).toFixed(1)} KB</td>
                      <td className="py-2 text-right">
                        <Button variant="ghost" onClick={() => downloadBlob(f.name.split("/").pop()!, f.content, f.mime)}>
                          <Download size={11} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Glass>

          <Glass>
            <div className="p-3 flex items-start gap-2 text-[12px] text-[var(--pc-text-secondary)]">
              <AlertCircle size={14} className="mt-0.5 text-[var(--pc-brand-primary)]" />
              <div>
                <strong>Trust signal:</strong> we encourage exports. If you ever need to leave PharmaCare, this same screen
                gives you everything ready for Marg / Tally / Vyapar / generic CSV import. No hostage data.
              </div>
            </div>
          </Glass>
        </>
      )}
    </div>
  );
}
