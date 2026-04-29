// @pharmacare/auto-update
// Update manifest format + version compat + channel selection.
// Self-hosted on Cloudflare Workers; no Squirrel/Sparkle dep.
//
// Tauri 2 has its own updater plugin — this package owns the manifest schema
// + client-side check logic so we can serve updates from any CDN.

// ────────────────────────────────────────────────────────────────────────
// Manifest schema (served at https://updates.pharmacare.in/manifest.json)
// ────────────────────────────────────────────────────────────────────────

export type ReleaseChannel = "stable" | "beta" | "nightly";

export interface ReleaseAsset {
  readonly platform: "windows-x86_64" | "windows-aarch64" | "macos-aarch64" | "macos-x86_64" | "linux-x86_64";
  readonly url: string;                 // signed CDN URL
  readonly sha256: string;
  readonly sizeBytes: number;
  /** Tauri-style ed25519 signature of the file. */
  readonly signature: string;
}

export interface ReleaseEntry {
  readonly version: string;             // semver "1.2.3" or "1.2.3-beta.1"
  readonly channel: ReleaseChannel;
  readonly publishedAt: string;         // ISO
  readonly notes: string;               // markdown release notes
  readonly minSupportedVersion?: string; // optional — block leapfrog from <X
  readonly assets: readonly ReleaseAsset[];
  readonly mandatory?: boolean;         // force update on next launch
}

export interface UpdateManifest {
  readonly product: "PharmaCare";
  readonly latest: Readonly<Record<ReleaseChannel, string>>;  // version per channel
  readonly releases: readonly ReleaseEntry[];
  readonly generatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// Semver utilities
// ────────────────────────────────────────────────────────────────────────

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly preRelease?: string;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/;

export function parseSemver(s: string): SemVer {
  const m = SEMVER_RE.exec(s);
  if (!m) throw new InvalidSemverError(s);
  const out: SemVer = {
    major: parseInt(m[1]!, 10),
    minor: parseInt(m[2]!, 10),
    patch: parseInt(m[3]!, 10),
    ...(m[4] !== undefined ? { preRelease: m[4] } : {}),
  };
  return out;
}

export class InvalidSemverError extends Error {
  public readonly code = "INVALID_SEMVER" as const;
  constructor(public readonly raw: string) { super(`INVALID_SEMVER: "${raw}"`); }
}

/** -1 if a < b; 0 if equal; +1 if a > b. */
export function compareSemver(a: string | SemVer, b: string | SemVer): -1 | 0 | 1 {
  const av = typeof a === "string" ? parseSemver(a) : a;
  const bv = typeof b === "string" ? parseSemver(b) : b;
  if (av.major !== bv.major) return av.major < bv.major ? -1 : 1;
  if (av.minor !== bv.minor) return av.minor < bv.minor ? -1 : 1;
  if (av.patch !== bv.patch) return av.patch < bv.patch ? -1 : 1;
  // Pre-release ordering: 1.0.0-alpha < 1.0.0 (per semver spec)
  if (av.preRelease && !bv.preRelease) return -1;
  if (!av.preRelease && bv.preRelease) return 1;
  if (av.preRelease && bv.preRelease) {
    return av.preRelease < bv.preRelease ? -1 : av.preRelease > bv.preRelease ? 1 : 0;
  }
  return 0;
}

export function isNewerThan(a: string, b: string): boolean {
  return compareSemver(a, b) === 1;
}

// ────────────────────────────────────────────────────────────────────────
// Channel filter
// ────────────────────────────────────────────────────────────────────────

/** Returns true if `entry`'s channel is at least as stable as `userChannel`.
 *  Stable < Beta < Nightly. A user on `stable` only sees stable.
 *  A user on `beta` sees stable + beta. A user on `nightly` sees all. */
export function channelMatches(entry: ReleaseChannel, userChannel: ReleaseChannel): boolean {
  const order = ["stable", "beta", "nightly"];
  return order.indexOf(entry) <= order.indexOf(userChannel);
}

// ────────────────────────────────────────────────────────────────────────
// Update check
// ────────────────────────────────────────────────────────────────────────

export interface UpdateCheckArgs {
  readonly currentVersion: string;
  readonly platform: ReleaseAsset["platform"];
  readonly channel: ReleaseChannel;
  readonly manifest: UpdateManifest;
}

export interface UpdateAvailable {
  readonly hasUpdate: true;
  readonly current: string;
  readonly target: string;
  readonly channel: ReleaseChannel;
  readonly mandatory: boolean;
  readonly notes: string;
  readonly asset: ReleaseAsset;
  readonly publishedAt: string;
}

export interface UpToDate {
  readonly hasUpdate: false;
  readonly current: string;
}

export type UpdateCheckResult = UpdateAvailable | UpToDate;

export function checkForUpdate(args: UpdateCheckArgs): UpdateCheckResult {
  // Find releases newer than current AND in our channel AND with our platform asset
  const candidates = args.manifest.releases.filter((r) =>
    channelMatches(r.channel, args.channel)
    && isNewerThan(r.version, args.currentVersion)
    && r.assets.some((a) => a.platform === args.platform),
  );
  if (candidates.length === 0) return { hasUpdate: false, current: args.currentVersion };

  // Pick the newest
  candidates.sort((a, b) => compareSemver(b.version, a.version));
  const target = candidates[0]!;
  const asset = target.assets.find((a) => a.platform === args.platform)!;

  // If minSupportedVersion blocks our current → mandatory
  let mandatory = target.mandatory ?? false;
  if (target.minSupportedVersion && compareSemver(args.currentVersion, target.minSupportedVersion) === -1) {
    mandatory = true;
  }

  return {
    hasUpdate: true,
    current: args.currentVersion,
    target: target.version,
    channel: target.channel,
    mandatory,
    notes: target.notes,
    asset,
    publishedAt: target.publishedAt,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Manifest validation (caller validates before trusting)
// ────────────────────────────────────────────────────────────────────────

export class InvalidManifestError extends Error {
  public readonly code = "INVALID_UPDATE_MANIFEST" as const;
  constructor(public readonly reason: string) { super(`INVALID_UPDATE_MANIFEST: ${reason}`); }
}

export function validateManifest(m: unknown): UpdateManifest {
  if (!m || typeof m !== "object") throw new InvalidManifestError("not an object");
  const x = m as Record<string, unknown>;
  if (x["product"] !== "PharmaCare") throw new InvalidManifestError(`product must be PharmaCare; got ${x["product"]}`);
  if (!Array.isArray(x["releases"])) throw new InvalidManifestError("releases must be array");
  if (typeof x["latest"] !== "object" || x["latest"] === null) throw new InvalidManifestError("latest must be object");

  for (const r of x["releases"] as unknown[]) {
    if (!r || typeof r !== "object") throw new InvalidManifestError("release entry must be object");
    const e = r as Record<string, unknown>;
    if (typeof e["version"] !== "string") throw new InvalidManifestError("release.version must be string");
    parseSemver(e["version"] as string);    // throws on bad semver
    if (!["stable", "beta", "nightly"].includes(e["channel"] as string)) {
      throw new InvalidManifestError(`bad channel: ${e["channel"]}`);
    }
    if (!Array.isArray(e["assets"])) throw new InvalidManifestError("release.assets must be array");
  }
  return m as UpdateManifest;
}
