#!/usr/bin/env python3
"""Generate synthetic Vaidyanath Pharmacy data shaped like a Marg ERP CSV export.

Outputs (relative to repo root):
  tools/synthetic-vaidyanath-master.csv     ~500 SKU rows + multi-batch dupes
  tools/synthetic-vaidyanath-customers.csv  ~200 customers, optional GSTIN
  tools/synthetic-vaidyanath-suppliers.csv  ~30 suppliers

Mirrors real Marg-export edge cases the importer must tolerate:
  - UTF-8 BOM at file start
  - CRLF line endings
  - Quoted fields with embedded commas
  - Devanagari mixed with English
  - Stray whitespace in HSN
  - Empty ScheduleClass = OTC
  - Mixed date formats: DD/MM/YYYY, DD-Mon-YYYY, DD/MM/YY, DD.MM.YYYY
  - Currency-prefix on rates
  - Duplicate ItemCode (multi-batch)
  - Manufacturer name variations (Cipla / CIPLA / Cipla Ltd)

Deterministic via seeded random.Random.
"""
from __future__ import annotations
import random
import datetime as dt
from pathlib import Path

SEED = 20260508
RNG = random.Random(SEED)
TODAY = dt.date(2026, 5, 8)

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "tools"

# ─────────────────────────── canonical lists ────────────────────────────

GENERIC_OTC = [
    ("Paracetamol 500mg", "Tab", "30049099", 12),
    ("Cetirizine 10mg", "Tab", "30049099", 12),
    ("Ibuprofen 400mg", "Tab", "30049099", 12),
    ("Aspirin 75mg", "Tab", "30049099", 12),
    ("Loratadine 10mg", "Tab", "30049099", 12),
    ("Ranitidine 150mg", "Tab", "30049099", 12),
    ("Omeprazole 20mg", "Cap", "30049099", 12),
    ("Pantoprazole 40mg", "Tab", "30049099", 12),
    ("Domperidone 10mg", "Tab", "30049099", 12),
    ("Ondansetron 4mg", "Tab", "30049099", 12),
    ("Metformin 500mg", "Tab", "30049099", 12),
    ("Glimepiride 1mg", "Tab", "30049099", 12),
    ("Atorvastatin 10mg", "Tab", "30049099", 12),
    ("Telmisartan 40mg", "Tab", "30049099", 12),
    ("Amlodipine 5mg", "Tab", "30049099", 12),
    ("Vitamin D3 60K", "Sachet", "30049099", 12),
    ("Vitamin B12 1500mcg", "Tab", "30049099", 12),
    ("Folic Acid 5mg", "Tab", "30049099", 12),
    ("Iron Folic Acid", "Tab", "30049099", 12),
    ("Calcium Carbonate 500mg", "Tab", "30049099", 12),
    ("Multivitamin Syrup 200ml", "Syrup", "30049099", 12),
    ("Cough Syrup 100ml", "Syrup", "30049099", 12),
    ("ORS Sachet 21g", "Sachet", "30049099", 5),
    ("Glucose D 100g", "Sachet", "21069099", 18),
    ("Antacid Gel 170ml", "Liquid", "30049099", 12),
]

BRANDED_OTC = [
    ("Crocin Advance", "Tab", "30049099", 12),
    ("Crocin 500mg टॅब", "Tab", "30049099", 12),
    ("Dolo 650mg", "Tab", "30049099", 12),
    ("Combiflam", "Tab", "30049099", 12),
    ("Disprin", "Tab", "30049099", 12),
    ("Vicks Action 500", "Tab", "30049099", 12),
    ("Saridon", "Tab", "30049099", 12),
    ("Pudin Hara Pearls", "Cap", "30049099", 12),
    ("Eno Fruit Salt 100g", "Sachet", "30049099", 12),
    ("Digene Gel 200ml", "Liquid", "30049099", 12),
    ("Becosules", "Cap", "30049099", 12),
    ("Revital H", "Cap", "30049099", 12),
    ("Volini Gel 75g", "Gel", "30049099", 12),
    ("Moov Spray 50g", "Spray", "30049099", 12),
    ("Iodex 16g", "Ointment", "30049099", 12),
]

SCHEDULE_H = [
    ("Amoxicillin 500mg", "Cap", "30041000", 12),
    ("Azithromycin 500mg", "Tab", "30041000", 12),
    ("Ciprofloxacin 500mg", "Tab", "30041000", 12),
    ("Levofloxacin 500mg", "Tab", "30041000", 12),
    ("Cefixime 200mg", "Tab", "30041000", 12),
    ("Doxycycline 100mg", "Cap", "30041000", 12),
    ("Metronidazole 400mg", "Tab", "30049099", 12),
    ("Norfloxacin 400mg", "Tab", "30041000", 12),
    ("Tramadol 50mg", "Cap", "30049099", 12),
    ("Diclofenac 50mg", "Tab", "30049099", 12),
    ("Prednisolone 5mg", "Tab", "30049099", 12),
    ("Dexamethasone 0.5mg", "Tab", "30049099", 12),
    ("Salbutamol Inhaler 200d", "Inhaler", "30049099", 12),
    ("Insulin Glargine 100IU", "Vial", "30043990", 5),
    ("Furosemide 40mg", "Tab", "30049099", 12),
]

SCHEDULE_H1 = [
    ("Diazepam 5mg", "Tab", "30049099", 18),
    ("Alprazolam 0.5mg", "Tab", "30049099", 18),
    ("Lorazepam 2mg", "Tab", "30049099", 18),
    ("Clonazepam 0.5mg", "Tab", "30049099", 18),
    ("Zolpidem 10mg", "Tab", "30049099", 18),
]

SCHEDULE_X = [
    ("Morphine Sulfate 10mg", "Tab", "30039011", 18),
    ("Pethidine 50mg", "Vial", "30039011", 18),
]

# Manufacturer pool with intentional case/whitespace variations (real Marg
# exports show this — same vendor enters the name slightly differently per
# session). The importer's canonicalization step should fold these.
MFR_VARIANTS = [
    ["Cipla", "CIPLA", "Cipla Ltd", "cipla "],
    ["GSK", "GlaxoSmithKline", "GSK Pharma", "gsk"],
    ["Sun Pharma", "Sun Pharmaceutical", "SUN PHARMA", "Sun Pharma Ltd"],
    ["Pfizer", "PFIZER", "Pfizer India"],
    ["Mankind", "Mankind Pharma", "MANKIND"],
    ["Sanofi", "Sanofi India", "SANOFI"],
    ["Abbott", "Abbott India", "ABBOTT"],
    ["Lupin", "Lupin Ltd", "LUPIN"],
    ["Dr Reddy's", "Dr. Reddy's Labs", "DR REDDYS", "Dr Reddys"],
    ["Zydus", "Zydus Cadila", "ZYDUS"],
    ["Torrent", "Torrent Pharma", "TORRENT"],
    ["Himalaya", "Himalaya Drug Co", "HIMALAYA"],
    ["Glenmark", "Glenmark Pharma", "GLENMARK"],
    ["Alkem", "Alkem Labs", "ALKEM"],
    ["Macleods", "Macleods Pharma", "MACLEODS"],
]

CITIES = ["Kalyan", "Thane", "Dombivli", "Ulhasnagar", "Ambernath", "Bhiwandi", "Mumbai", "Navi Mumbai"]
FIRST_NAMES = ["Asha", "Ramesh", "Priya", "Suresh", "Anita", "Vijay", "Sunita", "Rajesh",
               "Kavita", "Manish", "Pooja", "Amit", "Sneha", "Ravi", "Meera", "Nilesh",
               "Geeta", "Prakash", "Lata", "Sachin"]
LAST_NAMES = ["Patil", "Sharma", "Iyer", "Joshi", "Kulkarni", "Deshmukh", "Pawar", "Naik",
              "Shaikh", "Khan", "Singh", "Gupta", "Rao", "Mehta", "Shah", "Verma"]


def fmt_date(d: dt.date) -> str:
    """Pick one of four real-Marg date formats at random."""
    fmt = RNG.choice(["DDMMYYYY", "DDMonYYYY", "DDMMYY", "DDdMMdYYYY"])
    if fmt == "DDMMYYYY":
        return d.strftime("%d/%m/%Y")
    if fmt == "DDMonYYYY":
        return d.strftime("%d-%b-%Y")
    if fmt == "DDMMYY":
        return d.strftime("%d/%m/%y")
    return d.strftime("%d.%m.%Y")


def pick_expiry() -> dt.date:
    """5% expired, 10% within 90d, 85% future."""
    r = RNG.random()
    if r < 0.05:
        return TODAY - dt.timedelta(days=RNG.randint(1, 365))
    if r < 0.15:
        return TODAY + dt.timedelta(days=RNG.randint(1, 90))
    return TODAY + dt.timedelta(days=RNG.randint(91, 730))


def maybe_currency_prefix(amount: float) -> str:
    """Sometimes prefix with rupee symbol or `Rs.` to mimic dirty Marg exports."""
    r = RNG.random()
    s = f"{amount:.2f}"
    if r < 0.15:
        return f"₹{s}"  # ₹
    if r < 0.20:
        return f"Rs.{s}"
    return s


def maybe_pad_hsn(hsn: str) -> str:
    """20% trailing-space, 10% leading-space, 5% empty (importer should flag)."""
    r = RNG.random()
    if r < 0.20:
        return hsn + "  "
    if r < 0.30:
        return "  " + hsn
    return hsn


def maybe_devanagari(name: str) -> str:
    """5% mix Devanagari snippet into the name."""
    if RNG.random() < 0.05:
        return name + " टॅब"
    return name


def quote_if_needed(s: str) -> str:
    """Quote the field if it contains comma/quote/newline; double quotes inside."""
    if "," in s or '"' in s or "\n" in s:
        return '"' + s.replace('"', '""') + '"'
    return s


def csv_line(*cells: str) -> str:
    return ",".join(quote_if_needed(c) for c in cells)


# ─────────────────────────── master CSV ────────────────────────────────

def build_master_rows() -> list[list[str]]:
    pool: list[tuple[str, str, str, int, str]] = []
    # tag each item with its schedule class
    for n, p, h, g in GENERIC_OTC + BRANDED_OTC:
        pool.append((n, p, h, g, ""))
    for n, p, h, g in SCHEDULE_H:
        pool.append((n, p, h, g, "H"))
    for n, p, h, g in SCHEDULE_H1:
        pool.append((n, p, h, g, "H1"))
    for n, p, h, g in SCHEDULE_X:
        pool.append((n, p, h, g, "X"))

    # Target counts to hit ~500 lines and the requested mix:
    # 60% OTC generic, 25% branded OTC, 10% H, 4% H1, 1% X
    target = {"OTC_GEN": 300, "OTC_BR": 125, "H": 50, "H1": 20, "X": 5}
    rows: list[list[str]] = []
    sr = 1

    def draw(group: str) -> tuple[str, str, str, int, str]:
        if group == "OTC_GEN":
            return RNG.choice([(n, p, h, g, "") for n, p, h, g in GENERIC_OTC])
        if group == "OTC_BR":
            return RNG.choice([(n, p, h, g, "") for n, p, h, g in BRANDED_OTC])
        if group == "H":
            return RNG.choice([(n, p, h, g, "H") for n, p, h, g in SCHEDULE_H])
        if group == "H1":
            return RNG.choice([(n, p, h, g, "H1") for n, p, h, g in SCHEDULE_H1])
        return RNG.choice([(n, p, h, g, "X") for n, p, h, g in SCHEDULE_X])

    item_code_seen: dict[str, int] = {}

    def make_row(item_code: str, name: str, pack: str, hsn: str,
                 gst: int, sched: str) -> list[str]:
        nonlocal sr
        # Multi-batch dup: 12% chance reuse an existing item code with new batch
        # (ItemName/Mfr/HSN/MRP stay identical)
        mfr_group = RNG.choice(MFR_VARIANTS)
        mfr = RNG.choice(mfr_group)
        mrp = round(RNG.uniform(8, 1850), 2)
        purchase = round(mrp * RNG.uniform(0.55, 0.78), 2)
        selling = round(mrp * RNG.uniform(0.92, 1.00), 2)
        batch = f"B{RNG.randint(1000, 9999)}{RNG.choice('ABCDEFGH')}"
        exp = fmt_date(pick_expiry())
        qty = RNG.randint(0, 600)
        loc = f"R{RNG.randint(1, 8)}-S{RNG.randint(1, 12)}"
        notes = ""
        if RNG.random() < 0.10:
            notes = f"Pack: {pack}, blister"  # forces quoted field
        row = [
            str(sr),
            item_code,
            quote_if_needed(maybe_devanagari(name)) if False else maybe_devanagari(name),
            pack,
            mfr,
            maybe_pad_hsn(hsn),
            str(gst),
            maybe_currency_prefix(mrp),
            maybe_currency_prefix(purchase),
            maybe_currency_prefix(selling),
            sched,
            batch,
            exp,
            str(qty),
            loc,
            notes,
        ]
        sr += 1
        return row

    counters = {k: 0 for k in target}
    code_seq = 1
    # Build a stable code pool first so multi-batch dupes can reference real codes
    while sum(counters.values()) < sum(target.values()):
        # pick a group still under target
        groups_left = [g for g in target if counters[g] < target[g]]
        group = RNG.choice(groups_left)
        n, p, h, g, sch = draw(group)
        item_code = f"VPH-{code_seq:05d}"
        code_seq += 1
        rows.append(make_row(item_code, n, p, h, g, sch))
        counters[group] += 1
        item_code_seen[item_code] = len(rows) - 1
        # 12% chance: append a duplicate batch row for THIS code (multi-batch)
        if RNG.random() < 0.12:
            dup = make_row(item_code, n, p, h, g, sch)
            # keep the dup name/mfr identical to first occurrence to be realistic
            first = rows[item_code_seen[item_code]]
            dup[2] = first[2]    # name
            dup[3] = first[3]    # pack
            dup[4] = first[4]    # mfr
            dup[5] = first[5]    # hsn
            dup[6] = first[6]    # gst
            dup[7] = first[7]    # mrp
            rows.append(dup)
    return rows


def write_master() -> tuple[Path, int]:
    rows = build_master_rows()
    headers = ["SrNo", "ItemCode", "ItemName", "Pack", "Manufacturer", "HSN", "GST%",
               "MRP", "PurchaseRate", "SellingRate", "ScheduleClass", "BatchNo",
               "ExpDate", "Qty", "Loc", "Notes"]
    lines = [csv_line(*headers)]
    for r in rows:
        lines.append(csv_line(*r))
    body = "\r\n".join(lines) + "\r\n"
    # Add UTF-8 BOM to mimic Marg's Excel-flavored exports
    blob = b"\xef\xbb\xbf" + body.encode("utf-8")
    p = OUT_DIR / "synthetic-vaidyanath-master.csv"
    p.write_bytes(blob)
    return p, len(rows)


def write_customers() -> tuple[Path, int]:
    headers = ["CustomerCode", "CustomerName", "Phone", "GSTIN", "Address", "Balance"]
    rows: list[list[str]] = []
    for i in range(1, 201):
        fn = RNG.choice(FIRST_NAMES)
        ln = RNG.choice(LAST_NAMES)
        # 8% have an embedded comma in name (Smith, John style — quoted)
        if RNG.random() < 0.08:
            name = f"{ln}, {fn}"
        else:
            name = f"{fn} {ln}"
        phone = f"9{RNG.randint(100000000, 999999999)}"
        # 18% have GSTIN (B2B customers)
        if RNG.random() < 0.18:
            gstin = f"27{chr(RNG.randint(65,90))}{chr(RNG.randint(65,90))}{chr(RNG.randint(65,90))}{chr(RNG.randint(65,90))}{chr(RNG.randint(65,90))}{RNG.randint(1000,9999)}{chr(RNG.randint(65,90))}1Z{RNG.randint(0,9)}"
        else:
            gstin = ""
        addr = f"{RNG.randint(1, 999)} Main Rd, {RNG.choice(CITIES)}"
        balance = round(RNG.uniform(0, 5000), 2) if RNG.random() < 0.30 else 0
        rows.append([f"VC-{i:04d}", name, phone, gstin, addr, f"{balance:.2f}"])

    lines = [csv_line(*headers)]
    for r in rows:
        lines.append(csv_line(*r))
    body = "\r\n".join(lines) + "\r\n"
    blob = b"\xef\xbb\xbf" + body.encode("utf-8")
    p = OUT_DIR / "synthetic-vaidyanath-customers.csv"
    p.write_bytes(blob)
    return p, len(rows)


def write_suppliers() -> tuple[Path, int]:
    headers = ["SupplierCode", "SupplierName", "Phone", "GSTIN", "Address", "DLNo"]
    rows = []
    bases = ["Pharmarack", "Sai Distributors", "Konark Agencies", "Apex Pharma",
             "Maharashtra Drug House", "Mumbai Pharma", "Thane Trading", "Kalyan Medicos",
             "Western Drug Mart", "Vidarbha Pharma", "Konkan Distributors", "Bombay Pharma",
             "Sahyadri Agencies", "Pune Pharma Hub", "Nashik Drug House", "Aurangabad Pharma",
             "Latur Distributors", "Solapur Medicos", "Nagpur Pharma", "Amravati Drug",
             "Chandrapur Agencies", "Akola Pharma", "Jalgaon Distributors", "Dhule Medicos",
             "Sangli Pharma", "Kolhapur Drug", "Satara Agencies", "Beed Pharma",
             "Parbhani Drug", "Wardha Distributors"]
    for i, name in enumerate(bases, 1):
        phone = f"022{RNG.randint(20000000, 49999999)}"
        gstin = f"27{chr(RNG.randint(65,90))}{chr(RNG.randint(65,90))}{chr(RNG.randint(65,90))}{chr(RNG.randint(65,90))}{chr(RNG.randint(65,90))}{RNG.randint(1000,9999)}{chr(RNG.randint(65,90))}1Z{RNG.randint(0,9)}"
        addr = f"{RNG.randint(1,99)} {RNG.choice(['Industrial Estate','MIDC','Wholesale Market'])}, {RNG.choice(CITIES)}"
        dl = f"MH-{RNG.choice(['20B','21B'])}-{RNG.randint(10000,99999)}"
        rows.append([f"VS-{i:03d}", name, phone, gstin, addr, dl])
    lines = [csv_line(*headers)]
    for r in rows:
        lines.append(csv_line(*r))
    body = "\r\n".join(lines) + "\r\n"
    blob = b"\xef\xbb\xbf" + body.encode("utf-8")
    p = OUT_DIR / "synthetic-vaidyanath-suppliers.csv"
    p.write_bytes(blob)
    return p, len(rows)


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    mp, mc = write_master()
    cp, cc = write_customers()
    sp, sc = write_suppliers()
    print(f"WROTE  {mp.relative_to(REPO)}  ({mc} rows)")
    print(f"WROTE  {cp.relative_to(REPO)}  ({cc} rows)")
    print(f"WROTE  {sp.relative_to(REPO)}  ({sc} rows)")
    # NUL/BOM sanity
    for p in (mp, cp, sp):
        b = p.read_bytes()
        assert b.count(b"\x00") == 0, f"NUL in {p}"
        assert b.startswith(b"\xef\xbb\xbf"), f"missing BOM in {p}"
        assert b.count(b"\r\n") > 10, f"missing CRLF in {p}"


if __name__ == "__main__":
    main()
