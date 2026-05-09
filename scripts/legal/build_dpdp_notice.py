"""Build dpdp_privacy_notice_v0.9.docx — DPDP Act 2023 customer notice."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _lib import make_doc, title, subtitle, h1, h2, p, bul, num, sp, br, tbl, hf

OUT = os.path.normpath(os.path.join(HERE, "..", "..", "docs", "legal", "dpdp_privacy_notice_v0.9.docx"))

d = make_doc()
hf(d, "Vaidyanath Pharmacy — DPDP Privacy Notice v0.9 (lawyer review)",
   "DPDP Act 2023 + D&C Act 1940 — Posted at counter")

title(d, "CUSTOMER PRIVACY NOTICE")
subtitle(d, "Vaidyanath Pharmacy, Kalyan  —  DPDP Act 2023 + D&C Act 1940  —  v0.9 (Effective 2026-05-13)")
sp(d)

h1(d, "Part 1 — English (master)")

h2(d, "1.1 Identity of the Data Fiduciary")
p(d, "Vaidyanath Pharmacy (\"we\", \"the Pharmacy\") is the Data Fiduciary for your Personal Data within the meaning of Section 2(i) of the Digital Personal Data Protection Act, 2023 (\"DPDP Act\"). PharmaCare Technologies (Aivora017) is our Data Processor within the meaning of Section 2(k) of the DPDP Act.")
bul(d, "Pharmacy address: _________________________, Kalyan, Maharashtra _____")
bul(d, "Owner / Data Protection Officer (DPO): _________________________")
bul(d, "DPO contact: _________________________ (phone) / _________________________ (email)")
bul(d, "Grievance Officer: same as DPO unless separately notified at the counter and on this notice")

h2(d, "1.2 Categories of Personal Data we collect")
p(d, "When you buy medicines or dispense a prescription at our counter, we may collect:")
bul(d, "Your name (for the bill, GST credit, and refund);")
bul(d, "Your mobile number (for the bill, refund, SMS receipt if you opt in, and if you wish a digital copy);")
bul(d, "Your prescription image or copy if the medicine is a Schedule-H, H1 or X drug requiring a prescription register entry;")
bul(d, "The medicines purchased, quantity, price, GST charged, payment mode reference (UPI VPA / card last four digits / cash);")
bul(d, "For chronic-care or loyalty customers (only if you sign up): age band, chronic condition flag, doctor reference.")
p(d, "We do NOT collect: Aadhaar number, PAN (unless you provide for a high-value bill above ₹2 lakh), bank account details, biometrics, photo of customer, or any data the law does not require us to store.")

h2(d, "1.3 Purposes of processing")
num(d, "Billing and GST compliance — issuing the invoice, claiming and reversing input tax credit, GSTR-1/3B return filing.")
num(d, "Schedule-H register entry — recording the prescription for Schedule H/H1/X drugs as required by the Drugs and Cosmetics Rules, 1945, retained for at least two (2) years.")
num(d, "Refunds and returns — verifying the customer who originally bought the medicine.")
num(d, "Statutory inspection — making records available to the Drug Inspector, GST Officer, FDA, or other lawful authority on demand.")
num(d, "Customer service (only if you opt in) — refill reminders, SMS receipt copy, chronic-care follow-up.")
num(d, "Counterfeit-drug investigation — if a recall or batch alert affects medicines you purchased, contacting you.")
p(d, "We will NOT use your data for marketing to third parties, sale to data brokers, profiling for credit scoring, or any purpose other than the above.")

h2(d, "1.4 Lawful basis under DPDP")
tbl(d, [
    ["Purpose", "Lawful basis (DPDP Act §6 / §7)"],
    ["Billing, refund", "Necessary for the contract of sale (§7(b))"],
    ["Schedule-H register, GST filing, drug-recall outreach", "Necessary for compliance with law (§7(g))"],
    ["SMS opt-in receipts, refill reminders", "Consent (§6) — opt-in, withdrawable"],
    ["Loyalty programme", "Consent (§6) — opt-in, withdrawable"],
])

h2(d, "1.5 Retention")
tbl(d, [
    ["Data category", "Retention", "Reason"],
    ["Prescription register (Sch-H/H1/X)", "≥ 2 years", "Drugs and Cosmetics Rules, 1945"],
    ["GST invoices and ledgers", "≥ 6 years", "CGST Act §36"],
    ["Other financial records", "≥ 8 years", "Income-tax Act"],
    ["SMS opt-in record", "until consent is withdrawn", "DPDP §6(5)"],
    ["Loyalty profile", "until consent is withdrawn or two (2) years of inactivity", "DPDP §8(7)"],
])
p(d, "After the retention period, we erase your data unless you ask us to retain it longer for your own records.")

h2(d, "1.6 Cross-border transfer")
p(d, "We currently store your Personal Data only on a computer at our shop premises in Kalyan, India. We do NOT transfer your data abroad.")
p(d, "If we later enable any cloud feature (sync, AI Copilot, automatic update fetch), we will:")
bul(d, "Show you a separate consent prompt at the counter or in your customer copy;")
bul(d, "Tell you which country the data goes to;")
bul(d, "Restrict transfer to countries on the Central Government's notified list under Section 16 of the DPDP Act.")

h2(d, "1.7 Your rights as a Data Principal")
p(d, "Under the DPDP Act you have the right to:")
bul(d, "Access — ask what data we hold about you, in a readable format;")
bul(d, "Correction — ask us to correct mistakes (e.g., wrong phone number);")
bul(d, "Erasure — ask us to delete data, subject to the law-mandated retention above;")
bul(d, "Grievance redressal — complain to our Grievance Officer (contact in §1.1) and receive a response within thirty (30) days;")
bul(d, "Withdraw consent — for purposes processed on consent, at any time, without affecting prior lawful processing;")
bul(d, "Nominate — appoint a person to exercise your rights in case of your death or incapacity.")
p(d, "To exercise any right, contact the Grievance Officer in person at the counter, by phone, or by WhatsApp. We will acknowledge within seven (7) days and respond within thirty (30) days.")
p(d, "If you are not satisfied with our response, you may lodge a complaint with the Data Protection Board of India.")

h2(d, "1.8 Data security")
p(d, "We use:")
bul(d, "AES-256 encryption-at-rest for the Software's local database;")
bul(d, "Password-derived key envelopes (Argon2id) and a per-shop Data Encryption Key;")
bul(d, "Automatic logout after inactivity;")
bul(d, "Restricted access — only the Owner and named cashier(s);")
bul(d, "Nightly local backup; optional external backup on owner-controlled media;")
bul(d, "Signed software updates (ed25519) — we do not run unsigned updates.")
p(d, "We do NOT allow unsupervised remote access. Vendor support sessions are screen-share only, with the Owner present.")

h2(d, "1.9 Incident notification — CERT-In")
p(d, "In the event of a cyber-security incident affecting your data, we will:")
bul(d, "Notify the Indian Computer Emergency Response Team (CERT-In) within six (6) hours of becoming aware, as required by the CERT-In Cyber Security Directions, 2022;")
bul(d, "Notify the Data Protection Board and affected Data Principals as soon as reasonably practicable, at most within seventy-two (72) hours.")

h2(d, "1.10 Updates to this notice")
p(d, "We may update this notice. The current version is posted at the counter and on the customer-facing screen of the Software. Material changes (new processing purpose, new vendor, new cross-border transfer) are notified to you on your next visit and require fresh consent.")
p(d, "Effective date: 2026-05-13.   Version: 0.9.")

br(d)
h1(d, "Part 2 — Marathi summary  [MACHINE-TRANSLATED — human-rev Q-010]")
p(d, "टीप: हे अनुवाद एक मशीन-निर्मित मसौदा आहे. व्यावसायिक मराठी अनुवादकाद्वारे मानवी पुनरावलोकन (Q-010) पूर्ण होईपर्यंत केवळ संदर्भासाठी. आवृत्ती 0.9, दिनांक 08-05-2026.", italic=True)
sp(d)
p(d, "वैद्यनाथ फार्मसी — ग्राहक गोपनीयता सूचना (DPDP कायदा, 2023) — सारांश", bold=True)
num(d, "डेटा फिडुशियरी: वैद्यनाथ फार्मसी, कल्याण.")
num(d, "डेटा प्रोसेसर: PharmaCare Technologies (Aivora017).")
num(d, "कोणता डेटा गोळा केला जातो: आपले नाव, मोबाइल नंबर, औषधांची यादी, किंमत, GST, पावती क्रमांक. शेड्यूल-H/H1/X औषधांसाठी आपली प्रिस्क्रिप्शन प्रत.")
num(d, "उद्देश: बिलिंग, GST अनुपालन, शेड्यूल-H रजिस्टर, परतावा, ड्रग इन्स्पेक्टरच्या तपासणीसाठी.")
num(d, "साठवण कालावधी: प्रिस्क्रिप्शन रजिस्टर ≥ 2 वर्षे; GST रेकॉर्ड ≥ 6 वर्षे; आर्थिक रेकॉर्ड ≥ 8 वर्षे.")
num(d, "तुमचे हक्क: डेटा पाहणे, दुरुस्ती, मिटवणे (कायदेशीर मर्यादेत), तक्रार.")
num(d, "तक्रार अधिकारी: दुकान मालक. संपर्क: काउंटरवर / फोन / WhatsApp. प्रतिसाद ३० दिवसांच्या आत.")
num(d, "डेटा भारत-बाहेर पाठवला जात नाही. भविष्यात क्लाउड वैशिष्ट्ये चालू केली तर वेगळी संमती घेतली जाईल.")
num(d, "सुरक्षा: AES-256 एन्क्रिप्शन; मालक-नियंत्रित पासवर्ड; निशाणी केलेल्या अद्यतनांशिवाय अद्यतन नाही; नियंत्रित दूरस्थ समर्थन.")
num(d, "साइबर घटना: ६ तासांच्या आत CERT-In ला सूचना; ७२ तासांच्या आत डेटा संरक्षण मंडळ.")
sp(d)
p(d, "संपूर्ण इंग्रजी सूचना काउंटरवर उपलब्ध आहे.")

from _lib import save_doc; save_doc(d, OUT)
print("WROTE", OUT, os.path.getsize(OUT))
