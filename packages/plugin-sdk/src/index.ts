// @pharmacare/plugin-sdk
// Plugin manifest validation + capability gating.
// ADR-0061. WASM sandbox runtime is deferred (needs wasmtime-wasi); this
// package ships the type system + validation that gate every install.

// ────────────────────────────────────────────────────────────────────────
// Capabilities — what plugins can ask for. Owner approves each at install.
// ────────────────────────────────────────────────────────────────────────

export type Capability =
  | "read.bills"
  | "read.products"
  | "read.customers"
  | "read.audit"
  | "write.audit"
  | "write.products"
  | "write.customers"
  | "ui.add-tab"
  | "ui.add-modal"
  | "ui.add-shortcut"
  | "net.outbound.https"
  | "fs.read.documents"
  | "fs.write.documents";

/** Capabilities considered SENSITIVE — owner must explicitly approve at install. */
export const SENSITIVE_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "write.audit", "write.products", "write.customers",
  "net.outbound.https", "fs.read.documents", "fs.write.documents",
]);

// ────────────────────────────────────────────────────────────────────────
// Manifest schema
// ────────────────────────────────────────────────────────────────────────

export interface UiMount {
  readonly mountPoint: "main-nav" | "billing-tab" | "compliance-tab" | "reports-tab" | "command-palette";
  readonly component: string;             // module export name in the WASM binary
  readonly title: string;
  readonly icon?: string;                 // lucide icon name
}

export interface PluginManifest {
  readonly id: string;                    // reverse-DNS, e.g. com.acme.lab-integration
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly capabilities: readonly Capability[];
  readonly entry: string;                 // path to .wasm or .js
  readonly screens?: readonly UiMount[];
  readonly minHostVersion?: string;       // semver — e.g. "0.4.0"
  readonly homepageUrl?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Validation errors
// ────────────────────────────────────────────────────────────────────────

export class InvalidManifestError extends Error {
  public readonly code = "INVALID_MANIFEST" as const;
  public readonly reason: string;
  constructor(reason: string) {
    super(`INVALID_MANIFEST: ${reason}`);
    this.reason = reason;
  }
}

const REVERSE_DNS_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;

const ALL_CAPS = new Set<Capability>([
  "read.bills","read.products","read.customers","read.audit",
  "write.audit","write.products","write.customers",
  "ui.add-tab","ui.add-modal","ui.add-shortcut",
  "net.outbound.https","fs.read.documents","fs.write.documents",
]);

const ALL_MOUNTS = new Set<UiMount["mountPoint"]>([
  "main-nav","billing-tab","compliance-tab","reports-tab","command-palette",
]);

export function validateManifest(m: PluginManifest): void {
  if (!REVERSE_DNS_RE.test(m.id)) {
    throw new InvalidManifestError(`id must be reverse-DNS (e.g. com.acme.thing); got ${m.id}`);
  }
  if (!m.name || m.name.trim().length === 0) {
    throw new InvalidManifestError("name is required");
  }
  if (!SEMVER_RE.test(m.version)) {
    throw new InvalidManifestError(`version must be semver; got ${m.version}`);
  }
  if (!m.author || m.author.trim().length === 0) {
    throw new InvalidManifestError("author is required");
  }
  if (!m.description || m.description.length < 10) {
    throw new InvalidManifestError("description must be at least 10 chars (used in install dialog)");
  }
  if (!m.entry || m.entry.trim().length === 0) {
    throw new InvalidManifestError("entry is required");
  }
  for (const c of m.capabilities) {
    if (!ALL_CAPS.has(c)) {
      throw new InvalidManifestError(`unknown capability: ${c}`);
    }
  }
  if (m.screens) {
    for (const s of m.screens) {
      if (!ALL_MOUNTS.has(s.mountPoint)) {
        throw new InvalidManifestError(`unknown mountPoint: ${s.mountPoint}`);
      }
      // ui.add-tab capability required for any screen mount
      const usesTab = s.mountPoint.endsWith("-tab") || s.mountPoint === "main-nav";
      if (usesTab && !m.capabilities.includes("ui.add-tab")) {
        throw new InvalidManifestError(`screen at ${s.mountPoint} requires capability ui.add-tab`);
      }
      if (s.mountPoint === "command-palette" && !m.capabilities.includes("ui.add-shortcut")) {
        throw new InvalidManifestError(`command-palette mount requires capability ui.add-shortcut`);
      }
    }
  }
  if (m.minHostVersion && !SEMVER_RE.test(m.minHostVersion)) {
    throw new InvalidManifestError(`minHostVersion must be semver; got ${m.minHostVersion}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Capability gating — runtime check before each plugin RPC call
// ────────────────────────────────────────────────────────────────────────

export class CapabilityDeniedError extends Error {
  public readonly code = "CAPABILITY_DENIED" as const;
  public readonly pluginId: string;
  public readonly capability: Capability;
  constructor(pluginId: string, capability: Capability) {
    super(`CAPABILITY_DENIED: ${pluginId} requested ${capability} which was not granted`);
    this.pluginId = pluginId;
    this.capability = capability;
  }
}

export function assertCapability(
  pluginId: string,
  granted: ReadonlySet<Capability>,
  required: Capability,
): void {
  if (!granted.has(required)) throw new CapabilityDeniedError(pluginId, required);
}

/** True iff every capability in `required` is granted. */
export function hasAllCapabilities(
  granted: ReadonlySet<Capability>,
  required: readonly Capability[],
): boolean {
  return required.every((c) => granted.has(c));
}

/** Capability subset that the plugin asked for AND is sensitive (needs explicit owner approval). */
export function sensitiveSubset(requested: readonly Capability[]): readonly Capability[] {
  return requested.filter((c) => SENSITIVE_CAPABILITIES.has(c));
}

// ────────────────────────────────────────────────────────────────────────
// Host version compatibility
// ────────────────────────────────────────────────────────────────────────

export function isHostVersionCompatible(hostVersion: string, manifestMinVersion: string | undefined): boolean {
  if (!manifestMinVersion) return true;
  if (!SEMVER_RE.test(hostVersion) || !SEMVER_RE.test(manifestMinVersion)) return false;
  return semverGte(hostVersion, manifestMinVersion);
}

function semverGte(a: string, b: string): boolean {
  const pa = a.split(/[-+]/)[0]!.split(".").map(Number);
  const pb = b.split(/[-+]/)[0]!.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0, bi = pb[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return true;
}
