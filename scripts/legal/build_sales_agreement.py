"""Build sales_agreement_pilot_v0.9.docx — Pilot License Agreement."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _lib import make_doc, title, subtitle, h1, h2, p, bul, num, sp, br, tbl, hf

OUT = os.path.normpath(os.path.join(HERE, "..", "..", "docs", "legal", "sales_agreement_pilot_v0.9.docx"))

d = make_doc()
hf(d, "PharmaCare Pro — Pilot License Agreement v0.9 (lawyer review)",
   "PharmaCare Technologies (Aivora017) – Vaidyanath Pharmacy")

title(d, "PILOT LICENSE AGREEMENT")
subtitle(d, "PharmaCare Pro v0.1.0  —  v0.9 lawyer review draft  —  Effective on Go-Live (target 2026-05-13)")
sp(d)

h1(d, "1. Parties")
p(d, "This Pilot License Agreement (the \"Agreement\") is entered into on _____ day of _____, 2026, between:")
p(d, "(i) Vaidyanath Pharmacy, a sole proprietorship operating from _________________________, Kalyan, Maharashtra _____, holding Retail Drug Licence No. _____________ and GSTIN _____________ (the \"Owner\"); and")
p(d, "(ii) PharmaCare Technologies (a sole proprietorship operated by Mr. Sourav Shaw, with proposed conversion to a private limited company within ninety (90) days; current operating name on invoices: \"Aivora017\" — placeholder pending entity formation), correspondence address _________________________, India, email souravshawoffice@gmail.com (the \"Vendor\").")
p(d, "The Owner and the Vendor are individually a \"Party\" and collectively the \"Parties\".")

h1(d, "2. Definitions")
num(d, '"Software" means PharmaCare Pro v0.1.0 desktop application (Tauri build), associated installers, configuration files, packaged migrations, edge AI model bundles, and any patches issued during the AMC term.')
num(d, '"Pilot" means the three (3) calendar month period commencing on the Go-Live Date during which the Software is provided at zero cost.')
num(d, '"Go-Live Date" means 2026-05-13 (Wednesday) or such other date the Parties mutually agree in writing (WhatsApp acknowledgement is sufficient).')
num(d, '"AMC" means the Annual Maintenance Contract covering bug fixes, security patches, GST/DPDP regulatory updates, and remote support post-Pilot.')
num(d, '"Shop Premises" means the registered retail-pharmacy location of the Owner at the address recorded in Section 1.')
num(d, '"Authorized User" means the Owner, the Owner spouse or first-degree relatives engaged in the pharmacy, and up to two (2) named cashier employees of the Shop, each of whom shall accept the in-app DPDP and acceptable-use prompts on first login.')
num(d, '"Personal Data" has the meaning given in Section 2(t) of the Digital Personal Data Protection Act, 2023 ("DPDP Act").')
num(d, '"Data Fiduciary" and "Data Processor" have the meanings given in Sections 2(i) and 2(k) of the DPDP Act.')
num(d, '"Schedule-H Drug" means a drug specified in Schedule H, H1 or X to the Drugs and Cosmetics Rules, 1945.')
num(d, '"CERT-In" means the Indian Computer Emergency Response Team established under Section 70B of the Information Technology Act, 2000.')

h1(d, "3. License grant")
p(d, "3.1 Subject to the Owner's compliance with this Agreement, the Vendor grants the Owner a perpetual, non-exclusive, non-transferable, single-shop license to install, run and use the Software on one (1) primary Windows computer (the \"Primary Rig\") and one (1) hot-spare Windows computer (the \"Spare Rig\") at the Shop Premises, for the internal business operations of the Shop.")
p(d, "3.2 The license expressly includes:")
bul(d, "All v0.x patches issued during the AMC term;")
bul(d, "Up to four (4) Authorized Users registered concurrently;")
bul(d, "Local data export in JSON, CSV and SQLite formats at any time, with no extraction fee;")
bul(d, "The right to keep operating the Software perpetually after AMC lapses, with the binary as last delivered.")
p(d, "3.3 The license expressly excludes:")
bul(d, "Major-version upgrades (v1.0 and above) — offered to AMC-current Owners at a discount, but not automatic;")
bul(d, "Reverse engineering, sub-licensing, sale, lease, hosting-as-a-service, or use at any premises other than the Shop Premises;")
bul(d, "Removal or obscuring of license-key, watermark, copyright, or About-screen attribution.")

h1(d, "4. Pilot terms and pricing")
p(d, "4.1 Pilot is free. No fee, deposit, or onboarding charge is payable for the Pilot. Onsite installation, parallel-run support, 48-hour hotline, and one (1) hot-fix re-flash are included at no cost.")
p(d, "4.2 Post-Pilot pricing (Annexure A controls in case of conflict):")
bul(d, "Perpetual License (one-time): INR 14,999, payable within seven (7) days of the Pilot end date if the Owner elects to continue;")
bul(d, "AMC (annual, optional but recommended): INR 4,999 per year, covering patches, regulatory updates, hotline, and remote support;")
bul(d, "Multi-shop add-on (only if relevant later): per-shop perpetual at the same INR 14,999, AMC scaled per shop.")
p(d, "4.3 No SaaS, no per-bill, no per-user surcharge. This pricing model is permanent for the v0.x and v1.x branches.")
p(d, "4.4 Pilot exit option for the Owner. The Owner may terminate the Pilot at any time, for any reason, by written WhatsApp notice to the Vendor. On exit, the Vendor will assist with data export and removal of the Software at no charge.")
p(d, "4.5 Pilot exit option for the Vendor. The Vendor may withdraw the Software from the Pilot only on thirty (30) days' written notice and only for material breach by the Owner of Section 3 or Section 6.")

h1(d, "5. Installation and acceptance")
p(d, "5.1 The Vendor shall install the Software at the Shop Premises on the Go-Live Date and complete the installation runbook documented at pharmacare-pro/docs/pilot/vaidyanath_day1_install_runbook.docx.")
p(d, "5.2 Acceptance gate. The Pilot is deemed accepted when, within fourteen (14) calendar days of Go-Live, the Software produces thirty (30) consecutive customer bills with zero rupee discrepancy compared with the Owner's incumbent system (Marg / Tally / paper). The 30-bill gate tool is the authoritative measurement.")
p(d, "5.3 If the 30-bill gate is not met within fourteen (14) days, the Vendor shall remediate at no cost. If still not met within thirty (30) days from Go-Live, the Owner may exit under Section 4.4 with no liability.")

h1(d, "6. Support")
p(d, "6.1 Pilot phase (3 months): WhatsApp + voice hotline, 48-hour first-response SLA, business hours (10:00 – 19:00 IST) on weekdays and (11:00 – 17:00 IST) on Saturdays. Sundays best-effort.")
p(d, "6.2 Post-Pilot, AMC subscribed: Same channels, 7-business-day first-response SLA. Critical issues (cannot bill, data loss risk, compliance filing blocked) are best-effort within 24 hours.")
p(d, "6.3 Post-Pilot, AMC not subscribed: Software continues to run; no support obligation.")
p(d, "6.4 The Vendor maintains a written defect log shared with the Owner via WhatsApp at the end of each Pilot week.")

h1(d, "7. Data ownership and DPDP allocation")
p(d, "7.1 All data entered into, stored by, or generated by the Software at the Shop Premises is owned by the Owner. The Vendor claims no ownership over Personal Data, prescription data, sales data, vendor data, or any derivatives.")
p(d, "7.2 DPDP roles. The Owner is the Data Fiduciary for all customer Personal Data processed by the Software, within the meaning of Section 2(i) of the DPDP Act. The Vendor, when remotely supporting or upgrading the Software, acts as the Owner's Data Processor within the meaning of Section 2(k) read with Section 8(2) of the DPDP Act.")
p(d, "7.3 The Vendor shall:")
bul(d, "Process Personal Data only on the Owner's documented instructions;")
bul(d, "Not transfer Personal Data outside the Shop Premises except as required for remote support, and only with the Owner's per-incident consent recorded in writing (WhatsApp acknowledgement is sufficient);")
bul(d, "Implement reasonable security safeguards including AES-256 encryption-at-rest, password-derived key envelopes (Argon2id), and signed update binaries (ed25519);")
bul(d, "Notify the Owner within twenty-four (24) hours of becoming aware of any personal-data breach affecting the Shop's data, and assist the Owner with the CERT-In six (6) hour incident notification under the Cyber Security Directions, 2022;")
bul(d, "Delete or return all Personal Data, including remote-support logs, within thirty (30) days of termination of this Agreement.")
p(d, "7.4 Cross-border transfer. As of v0.x, the Software is LAN-first and stores all Personal Data inside the Shop Premises. Cloud sync, auto-update fetch, telemetry, and AI Copilot features are default OFF. If the Owner enables any feature that transmits Personal Data outside India, that feature shall surface a per-feature consent prompt referencing DPDP Section 16 (notified-country list), and the Owner shall be the controller of that consent.")
p(d, "7.5 Retention. The Owner controls retention. The Software's defaults align with statutory minima — prescription register entries retained at least two (2) years (Drugs and Cosmetics Rules, 1945); GST records retained at least six (6) years (CGST Section 36); financial records at least eight (8) years (Income-tax). The Owner may extend retention; the Vendor shall not shorten it.")

h1(d, "8. Intellectual property")
p(d, "8.1 The Software, including source code, binaries, model weights, design, brand and documentation, is and remains the exclusive intellectual property of the Vendor.")
p(d, "8.2 The Owner's data, the Owner's customizations of templates, print layouts, regional pharma vocabulary, and any product-master corrections are the exclusive intellectual property of the Owner and are licensed back to the Vendor on a non-exclusive, royalty-free basis solely for the purpose of providing support and improving the Software, with all PII redacted.")
p(d, "8.3 Feedback from the Owner — defect reports, feature suggestions, screen sketches — may be incorporated into the Software at the Vendor's discretion without payment, and without granting the Owner any further IP rights.")

h1(d, "9. Warranties and disclaimers")
p(d, "9.1 The Vendor warrants that the Software performs the core retail-pharmacy POS functions documented in the user manual on the Hardware Floor specified in Annexure B, free from material defects, for the duration of the AMC term.")
p(d, "9.2 CLINICAL DECISION SUPPORT IS NOT MEDICAL ADVICE. The Software's drug-drug-interaction (DDI) alerts, allergy alerts, dosing-band warnings, and counseling prompts are reference checks sourced from public formulary data. They are NOT a substitute for the professional judgement of a registered pharmacist or registered medical practitioner. The Owner shall ensure that all dispensing decisions are reviewed by a registered pharmacist as required under the Drugs and Cosmetics Act, 1940. The Vendor disclaims liability for any clinical outcome arising from over-reliance on Software-generated alerts.", bold=False)
p(d, "9.3 NO IMPLIED WARRANTIES. Save as expressly stated in this Section 9, the Software is provided AS IS and the Vendor disclaims all implied warranties of merchantability, fitness for a particular purpose, and non-infringement, to the maximum extent permitted by applicable law (which, under the Consumer Protection Act, 2019, may not exclude implied warranties for goods sold to a consumer; see also Section 12).")

h1(d, "10. Indemnity and limitation of liability")
p(d, "10.1 Vendor indemnity. The Vendor shall defend, indemnify and hold the Owner harmless from any third-party claim that the Software, in its as-delivered form, infringes the intellectual property rights of that third party in India, provided that the Owner notifies the Vendor in writing within seven (7) days of receiving the claim, gives sole control of the defence to the Vendor, and does not admit liability without the Vendor's consent.")
p(d, "10.2 Owner indemnity. The Owner shall defend, indemnify and hold the Vendor harmless from any claim arising out of (a) the Owner's unauthorized data inputs, including counterfeit-drug records or fabricated prescription images; (b) the Owner's failure to obtain consents required under the DPDP Act from the Owner's customers; or (c) the Owner's use of the Software in violation of any law applicable to the Shop.")
p(d, "10.3 Cap on Vendor liability. Save for liability arising from the Vendor's gross negligence, wilful misconduct, fraud, or breach of confidentiality of Personal Data, the Vendor's total aggregate liability under this Agreement shall not exceed the fees paid by the Owner to the Vendor in the twelve (12) months preceding the claim. During the Pilot, since no fees are paid, the cap is INR 14,999 (the equivalent of one perpetual license).")
p(d, "10.4 No indirect damages. Neither Party shall be liable for indirect, incidental, special, consequential, or exemplary damages, including loss of profit, loss of goodwill, or loss of business opportunity.")

h1(d, "11. Termination")
p(d, "11.1 Pilot termination by Owner: at any time, no cause, on WhatsApp written notice (Section 4.4).")
p(d, "11.2 Cause-termination by either Party: material breach not cured within fifteen (15) days of written notice describing the breach.")
p(d, "11.3 Effect of termination. On termination:")
bul(d, "The Software license continues for the binary already installed (perpetual nature);")
bul(d, "The Vendor's support obligation ends;")
bul(d, "Each Party returns or destroys the other Party's confidential information and Personal Data within thirty (30) days, except records each Party is required by law to retain;")
bul(d, "Sections 7 (data ownership), 8 (IP), 10 (indemnity), and 12 (dispute resolution) survive.")

h1(d, "12. Dispute resolution and governing law")
p(d, "12.1 This Agreement is governed by the laws of India, with primary jurisdiction in the courts of Mumbai, Maharashtra.")
p(d, "12.2 Tiered dispute resolution:")
bul(d, "Step 1 — direct discussion: the Parties shall meet (in person or by video) within seven (7) days of a written dispute notice.")
bul(d, "Step 2 — mediation: if unresolved within fifteen (15) days, the Parties shall attempt mediation under the Mediation Act, 2023, at a Mumbai mediation centre.")
bul(d, "Step 3 — arbitration: if unresolved within forty-five (45) days of the mediation start, the dispute shall be finally resolved by arbitration seated in Mumbai, conducted by a sole arbitrator appointed by mutual agreement, in English, under the Arbitration and Conciliation Act, 1996. The arbitrator's award is final and binding.")
p(d, "12.3 Consumer-protection carve-out. Nothing in Section 12 limits any right of the Owner, where the Owner qualifies as a \"consumer\" under the Consumer Protection Act, 2019, to approach the consumer redressal commissions. (Note for lawyer: confirm whether a registered retail pharmacy purchasing software for business use qualifies as a \"consumer\" under the 2019 Act; if yes, the arbitration clause may need to carve out non-commercial disputes — see Q-009.)")

h1(d, "13. Miscellaneous")
p(d, "13.1 Notices. Notices may be given by WhatsApp message + email read-receipt for Pilot-phase operational matters. Formal notices (breach, termination) require email and registered post.")
p(d, "13.2 Force majeure. Neither Party is liable for delay caused by acts of God, war, civil disturbance, internet outage at the Shop Premises beyond seventy-two (72) hours, government action, or pandemic.")
p(d, "13.3 Severability. If any provision is held invalid, the remainder continues in force.")
p(d, "13.4 Entire agreement. This Agreement, together with Annexures A and B, is the entire agreement between the Parties on its subject matter and supersedes the prior Pilot_Sales_Agreement.docx v0.1 draft.")
p(d, "13.5 Amendments. Amendments require written consent of both Parties (signed PDF or eSign).")

br(d)
h1(d, "Annexure A — Pricing schedule")
tbl(d, [
    ["Item", "Charge", "When payable"],
    ["Pilot (3 months)", "INR 0", "Pilot start"],
    ["Onboarding + onsite install", "INR 0", "Pilot start"],
    ["48-hour hotline (Pilot)", "INR 0", "Pilot start"],
    ["Perpetual license post-Pilot", "INR 14,999 (one-time)", "Within 7 days of Pilot end if Owner continues"],
    ["AMC Year 1", "INR 4,999", "On the post-Pilot License invoice"],
    ["AMC renewal Year 2+", "INR 4,999", "Annual, on AMC anniversary"],
    ["Major-version upgrade (v1.0+)", "Discount for AMC-current Owners; price quoted on release", "At upgrade time"],
    ["Onsite revisit post-Pilot", "INR 2,500 within Mumbai-Thane-Kalyan; travel at cost beyond", "Per visit"],
    ["Data export, training reprint", "INR 0", "Always free"],
])

sp(d)
h1(d, "Annexure B — SLA targets")
tbl(d, [
    ["Metric", "Target", "Measurement"],
    ["Billing uptime (per calendar month)", "≥ 95% during business hours", "Heartbeat + defect log"],
    ["Recovery Point Objective (RPO)", "≤ 5 minutes", "Latest snapshot timestamp at incident"],
    ["Recovery Time Objective (RTO)", "≤ 30 minutes", "WhatsApp → online time"],
    ["First-response (Pilot, hotline)", "≤ 48 hours", "WhatsApp/voice timestamp"],
    ["First-response (post-Pilot AMC)", "≤ 7 business days", "WhatsApp/voice timestamp"],
    ["Hardware floor", "Win 7/8/10/11; ≥ 2 GB RAM; HDD OK", "At install"],
    ["RAM resident max", "300 MB", "Task Manager peak"],
    ["Cold start", "< 3 s on i3-8100/4GB", "First-bill SLO"],
    ["p95 bill creation", "< 400 ms", "Telemetry (default OFF) or stopwatch"],
    ["LAN failover (parent ↔ worker)", "< 2 s", "LAN test"],
    ["Backup cadence", "Nightly local + on-demand external", "Snapshot timestamps"],
])

br(d)
h1(d, "Signature block")
sp(d)
p(d, "Signed for the Owner:")
p(d, "Name: _______________________________   Date: _____________   Place: _____________")
p(d, "Signature: ___________________________________")
sp(d)
p(d, "Signed for the Vendor:")
p(d, "Name: Sourav Shaw   Date: _____________   Place: _____________")
p(d, "Signature: ___________________________________")
sp(d)
p(d, "Witness 1: _______________________________   Witness 2: _______________________________")

from _lib import save_doc; save_doc(d, OUT)
print("WROTE", OUT, os.path.getsize(OUT))
