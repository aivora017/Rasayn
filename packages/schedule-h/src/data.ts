// Canonical Schedule H1 + Schedule X molecule lists for Indian Drugs &
// Cosmetics Rules 1945 compliance.
//
// Sources:
//   - Schedule H1: GSR 588(E), Ministry of Health & Family Welfare,
//     30-Aug-2013, effective 01-Mar-2014. Retail sale only against Rx from
//     RMP; separate register retained 3 years; Rx copy retained 3 years.
//   - Schedule X: Rule 65(2) of the Drugs & Cosmetics Rules 1945. Sale
//     against Rx only from RMP; Rx retained 2 years; double-lock storage;
//     special form register.
//
// All names are stored lowercased and trimmed; classifier normalises input
// the same way. Salt forms (hydrochloride, sulphate, sodium, etc.) are
// stripped before lookup so "tramadol hydrochloride" matches "tramadol".
//
// When a molecule appears in BOTH H1 and X (historically Pentazocine),
// Schedule X wins — the stricter register applies.

/** Schedule H1 molecules — GSR 588(E). */
export const SCHEDULE_H1: readonly string[] = [
  "alprazolam",
  "balofloxacin",
  "buprenorphine",
  "capreomycin",
  "cefdinir",
  "cefditoren",
  "cefepime",
  "cefetamet",
  "cefixime",
  "cefoperazone",
  "cefotaxime",
  "cefpirome",
  "cefpodoxime",
  "ceftazidime",
  "ceftibuten",
  "ceftizoxime",
  "ceftriaxone",
  "chlordiazepoxide",
  "clofazimine",
  "codeine",
  "cycloserine",
  "diazepam",
  "diphenoxylate",
  "ertapenem",
  "ethambutol",
  "ethionamide",
  "faropenem",
  "gatifloxacin",
  "imipenem",
  "isoniazid",
  "levofloxacin",
  "meropenem",
  "midazolam",
  "moxifloxacin",
  "nitrazepam",
  "prulifloxacin",
  "pyrazinamide",
  "rifabutin",
  "rifampicin",
  "sodium para-aminosalicylate",
  "sparfloxacin",
  "thiacetazone",
  "tramadol",
  "zolpidem",
] as const;

/** Schedule X molecules — Rule 65(2), D&C Rules 1945. */
export const SCHEDULE_X: readonly string[] = [
  "amobarbital",
  "amphetamine",
  "barbital",
  "cyclobarbital",
  "dexamphetamine",
  "ethclorvynol",
  "glutethimide",
  "meclonazepam",
  "methaqualone",
  "methamphetamine",
  "methylphenidate",
  "pentazocine",
  "pentobarbital",
  "phencyclidine",
  "phenmetrazine",
  "secobarbital",
] as const;

/** Salt / form suffixes stripped before molecule match. */
export const SALT_SUFFIXES: readonly string[] = [
  "hydrochloride",
  "hcl",
  "sulphate",
  "sulfate",
  "sodium",
  "potassium",
  "calcium",
  "citrate",
  "phosphate",
  "maleate",
  "tartrate",
  "acetate",
  "succinate",
  "fumarate",
  "mesylate",
  "besylate",
  "tosylate",
  "dihydrate",
  "monohydrate",
  "trihydrate",
];
