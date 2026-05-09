import os, sys
HERE = "/sessions/epic-festive-einstein/mnt/Rasayn/pharmacare-pro/scripts/legal"
sys.path.insert(0, HERE)
from _lib import make_doc, title, subtitle, h1, h2, p, bul, num, sp, br, tbl, hf
OUT = "/sessions/epic-festive-einstein/mnt/Rasayn/pharmacare-pro/docs/legal/lawyer_review_memo_v0.9.docx"

d = make_doc()
hf(d, "PharmaCare Pro -- Lawyer review cover memo v0.9", "Sourav Shaw -- souravshawoffice@gmail.com -- 2026-05-10")
title(d, "PILOT LEGAL KIT -- REVIEW REQUEST")
subtitle(d, "Cover memo to outside counsel -- v0.9 (forwarded by founder Sun 2026-05-10)")
sp(d)

p(d, "To:    [Lawyer name + firm -- to be filled by Sourav]")
p(d, "From:  Sourav Shaw, founder, PharmaCare Technologies (Aivora017), souravshawoffice@gmail.com, +91 _____________")
p(d, "Date:  2026-05-10 (forwarded by founder)")
p(d, "Subject: Review request -- pilot legal kit (Sales Agreement + DPDP Notice + Consent), 5 BD turnaround.")
sp(d)

h1(d, "Context")
p(d, "PharmaCare Pro is a desktop pharmacy POS for Indian independent pharmacies. We are running our first paid pilot at Vaidyanath Pharmacy, Kalyan, going live Wednesday 2026-05-13 (5 days from today). The pilot is 3 months free. After the pilot, the owner pays:")
bul(d, "INR 14,999 perpetual license (one-time, single shop), and")
bul(d, "INR 4,999 AMC per year (optional, recommended).")
p(d, "We do NOT sell SaaS. The pricing model is permanent. Code freeze for the pilot is Sun May 10 EOD; this packet goes to you on the same day.")

h1(d, "Three documents in this packet")
num(d, "sales_agreement_pilot_v0.9.docx -- pilot license agreement, ~10 pages, 13 sections + 2 annexures + signature block.")
num(d, "dpdp_privacy_notice_v0.9.docx -- customer-facing privacy notice under DPDP Act 2023, English + machine-translated Marathi summary.")
num(d, "customer_consent_v0.9.docx -- short consent form, English + Marathi + Hindi (Marathi/Hindi machine-translated, flagged for human review).")
p(d, "A source markdown is at _research_brain/06_pilot/legal_kit_source.md if you prefer diff-able source.")

h1(d, "Specific questions for you")
num(d, "DPDP Section 10 + Section 13 -- fiduciary/processor split correct? We allocate the Owner (Vaidyanath) as Data Fiduciary and PharmaCare Technologies as Data Processor in Section A.7.2 of the Sales Agreement and Section B.1.1 of the Privacy Notice. We argue the Owner controls purpose + means, the Vendor only acts on documented instructions during remote support. Is this allocation defensible if a Data Principal complains to the Data Protection Board?")
num(d, "Indemnity / warranty -- too generous to vendor? Section A.10 caps Vendor liability at INR 14,999 for the Pilot (one license fee equivalent), with carve-outs for gross negligence, wilful misconduct, fraud, and personal-data confidentiality. Section A.9.2 disclaims clinical-decision-support liability (DDI alerts are reference, not medical advice). Is the cap defensible given the Pilot is free? Are the carve-outs in A.10.3 sufficient under Indian law?")
num(d, "Cross-border transfer -- safe assuming we may turn cloud sync ON later? Section A.7.4 + Section B.1.6 say currently NIL, default OFF, and require a separate per-feature consent for any future cloud feature, restricted to Section-16 notified countries. Does this language hold up if we enable Cloudflare R2 storage (regions including India + global) under a feature flag? Do we need a more specific list of countries up front?")
num(d, "Mumbai arbitration vs Consumer Protection Act 2019. Section A.12 routes disputes to mediation then arbitration in Mumbai. A.12.3 carves out the Owner right to approach consumer-redressal commissions if the Owner qualifies as a consumer. Does a registered retail pharmacy buying business software qualify as a consumer under the 2019 Act? If yes, the arbitration clause may need a clearer carve-out. Separately: if the dispute is brought by an end-customer (Data Principal) of the pharmacy against us as Data Processor, does the arbitration clause apply at all, or do we need a separate customer-facing dispute clause?")
num(d, "Schedule-H + NDPS register references -- any miss? Section B.1.3 + B.1.5 reference the Schedule-H register (>= 2 years). The current draft does NOT explicitly cover the NDPS Form-IV register or psychotropic/narcotic Schedule-X separately. The Software supports them but the legal kit may need a paragraph. Please flag if an addition is needed.")
num(d, "Bonus -- entity formation. PharmaCare Technologies is currently a sole proprietorship operated by Sourav Shaw under the trading name Aivora017, with a planned conversion to a private limited company within 90 days. Do we need to add an assignment-on-conversion clause to Section A.13 so the license auto-transfers to the new pvt-ltd entity without renegotiation?")

h1(d, "Turnaround + delivery format")
bul(d, "Asked turnaround: 5 business days from receipt (so by Mon 2026-05-18 EOD if you receive Mon May 11).")
bul(d, "Format: track-changes red-line on the same .docx files, returned to souravshawoffice@gmail.com. Plain-text summary of high-impact changes appreciated.")
bul(d, "Pilot already lives May 13. We will sign the v0.9 with Vaidyanath on May 13 and re-execute v1.0 (post your red-line) within seven (7) days of receiving your changes.")
bul(d, "Compensation: as per separate engagement letter.")
sp(d)
p(d, "Thank you for the quick turnaround. Happy to clarify on a 15-minute call any time.")
sp(d)
p(d, "-- Sourav Shaw")

from _lib import save_doc; save_doc(d, OUT)
print("WROTE", OUT, os.path.getsize(OUT))
