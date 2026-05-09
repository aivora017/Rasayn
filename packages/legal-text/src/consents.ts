// @pharmacare/legal-text/consents
// Customer-consent strings for the BillingScreen consent modal + OnboardingWizard DPDP step.
//
// Source: _research_brain/06_pilot/legal_kit_source.md §C (v0.9 2026-05-08).
// Marathi + Hindi are MACHINE-TRANSLATED and gated by `humanReviewed: false`
// until Q-010 (lawyer/translator review) drains. Do NOT remove that flag
// without a corresponding USER_INPUT_QUEUE drain entry.
//
// Wire-up:
//   import { CONSENT_STRINGS, getConsent, type Locale } from "@pharmacare/legal-text/consents";
//   const c = getConsent("mr"); // returns Marathi block
//   modal.title = c.title; modal.body = c.body; modal.smsOptIn = c.smsOptIn;

export type Locale = "en" | "hi" | "mr";

export interface ConsentStrings {
  /** ISO locale */
  readonly locale: Locale;
  /** Modal/header title */
  readonly title: string;
  /** Bulleted body — each string is one bullet, rendered as <li> by the UI */
  readonly body: readonly string[];
  /** Short footer label shown next to the tick-box */
  readonly checkboxLabel: string;
  /** SMS opt-in sub-prompt (separate tick-box) */
  readonly smsOptIn: string;
  /** "Read the full policy" link label (full notice opens in a new modal) */
  readonly seeFullNotice: string;
  /** Withdraw-consent label for Settings → Privacy */
  readonly withdrawLabel: string;
  /** Grievance-officer label (printed on customer copy) */
  readonly grievanceLabel: string;
  /** True iff strings have been reviewed by a human translator (Q-010) */
  readonly humanReviewed: boolean;
  /** Source-doc version for audit trail */
  readonly sourceVersion: string;
}

const SOURCE_VERSION = "legal_kit_source.md v0.9 (2026-05-08)";

export const CONSENT_STRINGS: Readonly<Record<Locale, ConsentStrings>> = {
  en: {
    locale: "en",
    title: "Consent — Personal Data (DPDP Act 2023 + D&C Act 1940)",
    body: [
      "I agree that this pharmacy may store my name, mobile number, and the medicines I buy today, for billing, GST credit, refund processing, and the Schedule-H prescription register required under the Drugs and Cosmetics Rules, 1945.",
      "I understand this data is stored only on the computer at this shop's premises and will not be transferred outside India unless I give a separate consent.",
      "I have the right, at any time, to ask what data is stored about me, to ask for corrections, and to ask for deletion subject to legal retention periods (≥2 years for Schedule-H register; ≥6 years for GST records).",
      "I have read or had read out to me the full Privacy Notice posted at the counter.",
    ],
    checkboxLabel: "I agree (DPDP consent)",
    smsOptIn:
      "Optional: I agree to receive bill receipt and refill reminders by SMS on my mobile number above. I can withdraw at any time by telling the counter staff.",
    seeFullNotice: "Read the full Privacy Notice",
    withdrawLabel: "Withdraw consent",
    grievanceLabel: "Grievance Officer",
    humanReviewed: true,
    sourceVersion: SOURCE_VERSION,
  },

  // Marathi — MACHINE-TRANSLATED draft, awaiting human review (Q-010).
  mr: {
    locale: "mr",
    title: "संमती — वैयक्तिक डेटा (DPDP कायदा 2023 + औषध व सौंदर्यप्रसाधन कायदा 1940)",
    body: [
      "ही फार्मसी आज या काउंटरवरून मी खरेदी केलेल्या औषधांचा तपशील, माझे नाव, आणि मोबाइल नंबर बिल जारी करण्यासाठी, GST क्रेडिटसाठी, परताव्यासाठी, आणि औषध व सौंदर्यप्रसाधन नियम 1945 अंतर्गत आवश्यक शेड्यूल-H प्रिस्क्रिप्शन रजिस्टरसाठी साठवू शकते याला माझी संमती आहे.",
      "हा डेटा फक्त या दुकानाच्या परिसरातील संगणकावर साठवला जाईल, आणि स्वतंत्र संमतीशिवाय भारताबाहेर पाठवला जाणार नाही.",
      "कोणत्याही वेळी माझा डेटा काय साठवला आहे हे विचारण्याचा, दुरुस्तीसाठी विनंती करण्याचा, आणि कायदेशीर मर्यादेच्या अधीन राहून हटवण्याची विनंती करण्याचा मला हक्क आहे (शेड्यूल-H रजिस्टर ≥ 2 वर्षे; GST रेकॉर्ड ≥ 6 वर्षे).",
      "काउंटरवर लावलेली संपूर्ण गोपनीयता सूचना मी वाचली आहे किंवा माझ्या पसंतीच्या भाषेत मला वाचून दाखवली आहे.",
    ],
    checkboxLabel: "मी सहमत आहे (DPDP संमती)",
    smsOptIn:
      "पर्यायी: वरील मोबाइल नंबरवर बिल पावती आणि रिफिल स्मरणपत्रे SMS द्वारे प्राप्त करण्यास मी सहमत आहे. कधीही काउंटर स्टाफला सांगून मी ही संमती मागे घेऊ शकतो/शकते.",
    seeFullNotice: "संपूर्ण गोपनीयता सूचना वाचा",
    withdrawLabel: "संमती मागे घ्या",
    grievanceLabel: "तक्रार अधिकारी",
    humanReviewed: false,
    sourceVersion: SOURCE_VERSION,
  },

  // Hindi — MACHINE-TRANSLATED draft, awaiting human review (Q-010).
  hi: {
    locale: "hi",
    title: "सहमति — व्यक्तिगत डेटा (DPDP अधिनियम 2023 + ड्रग्स एंड कॉस्मेटिक्स एक्ट 1940)",
    body: [
      "यह फार्मसी आज इस काउंटर से मेरे द्वारा खरीदी गई दवाओं का विवरण, मेरा नाम, और मोबाइल नंबर बिल जारी करने, GST क्रेडिट, रिफंड प्रक्रिया, और औषधि एवं प्रसाधन नियम 1945 के तहत आवश्यक शेड्यूल-H प्रिस्क्रिप्शन रजिस्टर के प्रयोजनों के लिए संगृहीत कर सकती है, इस पर मेरी सहमति है।",
      "यह डेटा केवल इस दुकान के परिसर के कंप्यूटर पर संगृहीत किया जाएगा, और अलग सहमति के बिना भारत के बाहर नहीं भेजा जाएगा।",
      "किसी भी समय यह पूछने का, सुधार माँगने का, और कानूनी अवधारण सीमाओं के अधीन रहते हुए विलोपन माँगने का मुझे अधिकार है (शेड्यूल-H रजिस्टर ≥ 2 वर्ष; GST रिकॉर्ड ≥ 6 वर्ष)।",
      "काउंटर पर लगी पूरी गोपनीयता सूचना मैंने पढ़ी है या मेरी पसंदीदा भाषा में मुझे पढ़कर सुनाई गई है।",
    ],
    checkboxLabel: "मैं सहमत हूँ (DPDP सहमति)",
    smsOptIn:
      "वैकल्पिक: उपरोक्त मोबाइल नंबर पर बिल रसीद और रिफिल अनुस्मारक SMS के माध्यम से प्राप्त करने के लिए मैं सहमत हूँ। काउंटर स्टाफ को बताकर कभी भी मैं इस सहमति को वापस ले सकता/सकती हूँ।",
    seeFullNotice: "पूरी गोपनीयता सूचना पढ़ें",
    withdrawLabel: "सहमति वापस लें",
    grievanceLabel: "शिकायत अधिकारी",
    humanReviewed: false,
    sourceVersion: SOURCE_VERSION,
  },
} as const;

/**
 * Look up the consent block for a locale. Falls back to "en" for unknown locales,
 * which keeps BillingScreen safe if Settings has a stale value.
 */
export function getConsent(locale: string): ConsentStrings {
  const key = (locale ?? "en").toLowerCase();
  if (key === "mr" || key === "mr-in") return CONSENT_STRINGS.mr;
  if (key === "hi" || key === "hi-in") return CONSENT_STRINGS.hi;
  return CONSENT_STRINGS.en;
}

/**
 * Returns true if every locale has been human-reviewed. Wire this into a
 * compliance dashboard tile so the founder sees when Q-010 drains.
 */
export function allLocalesReviewed(): boolean {
  return (Object.values(CONSENT_STRINGS) as ConsentStrings[]).every(
    (c) => c.humanReviewed,
  );
}

/** List the locales currently flagged for human review. */
export function pendingHumanReview(): readonly Locale[] {
  return (Object.values(CONSENT_STRINGS) as ConsentStrings[])
    .filter((c) => !c.humanReviewed)
    .map((c) => c.locale);
}
