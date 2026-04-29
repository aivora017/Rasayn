// PluginMarketplaceScreen — browse + install third-party plugins.
import { useCallback, useState } from "react";
import { PuzzleIcon as Puzzle, Download, AlertTriangle, ShieldCheck } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  validateManifest, sensitiveSubset, isHostVersionCompatible,
  SENSITIVE_CAPABILITIES, type PluginManifest, type Capability, InvalidManifestError,
} from "@pharmacare/plugin-sdk";

const HOST_VERSION = "0.1.0";

const SAMPLE_PLUGINS: PluginManifest[] = [
  {
    id: "com.acme.lab-orders",
    name: "Lab Orders Sync",
    version: "1.2.0",
    author: "Acme Diagnostics",
    description: "Pull lab orders from Acme into PharmaCare and dispense the prescribed drug bundle in one click.",
    capabilities: ["read.bills", "read.customers", "ui.add-tab", "net.outbound.https"] as Capability[],
    entry: "lab.wasm",
    screens: [{ mountPoint: "billing-tab", component: "LabPanel", title: "Lab orders" }],
    minHostVersion: "0.1.0",
    homepageUrl: "https://acme-diagnostics.in/pharmacare",
  },
  {
    id: "com.cohealth.insurance-claims",
    name: "Insurance Claim Helper",
    version: "0.3.0",
    author: "CoHealth",
    description: "Auto-prepare TPA claim forms from a bill. Supports Bajaj Allianz, Star Health, Niva Bupa.",
    capabilities: ["read.bills", "ui.add-tab", "net.outbound.https"] as Capability[],
    entry: "insurance.wasm",
    minHostVersion: "0.1.0",
  },
  {
    id: "in.gov.cdsco.recall-watch",
    name: "CDSCO Recall Watch",
    version: "0.0.5",
    author: "Volunteer / CDSCO public",
    description: "Cross-checks your inventory against CDSCO recall notices nightly. Sends alert when a stocked batch is recalled.",
    capabilities: ["read.products", "write.audit", "net.outbound.https"] as Capability[],
    entry: "recall.wasm",
    minHostVersion: "0.1.0",
  },
];

export default function PluginMarketplaceScreen(): React.ReactElement {
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PluginManifest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const startInstall = useCallback((m: PluginManifest) => {
    try {
      validateManifest(m);
      if (!isHostVersionCompatible(HOST_VERSION, m.minHostVersion)) {
        throw new Error(`Host version ${HOST_VERSION} is older than minimum ${m.minHostVersion}.`);
      }
      setPending(m);
      setErr(null);
    } catch (e) {
      setErr(e instanceof InvalidManifestError ? (e as Error).message : String(e));
    }
  }, []);

  const confirmInstall = useCallback(() => {
    if (!pending) return;
    setInstalled((s) => new Set(s).add(pending.id));
    setPending(null);
  }, [pending]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="plugin-marketplace">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Puzzle size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Plugin Marketplace</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Third-party extensions · sandboxed · capability-gated
            </p>
          </div>
        </div>
        <Badge variant="neutral">host {HOST_VERSION}</Badge>
      </header>

      {err && (
        <Glass>
          <div className="p-3 flex gap-2 text-[13px] text-[var(--pc-state-danger)]">
            <AlertTriangle size={16} className="mt-0.5" /> {err}
          </div>
        </Glass>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {SAMPLE_PLUGINS.map((m) => {
          const isInstalled = installed.has(m.id);
          const sensitive = sensitiveSubset(m.capabilities);
          return (
            <Glass key={m.id}>
              <div className="p-4 flex flex-col gap-2 h-full">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-medium">{m.name}</h2>
                    <p className="text-[11px] text-[var(--pc-text-tertiary)]">{m.id} · v{m.version} · by {m.author}</p>
                  </div>
                  {isInstalled
                    ? <Badge variant="success"><ShieldCheck size={10} /> INSTALLED</Badge>
                    : <Button variant="ghost" onClick={() => startInstall(m)}><Download size={12} /> Install</Button>}
                </div>
                <p className="text-[13px] text-[var(--pc-text-secondary)]">{m.description}</p>
                <div className="flex flex-wrap gap-1 mt-auto">
                  {m.capabilities.map((c) => (
                    <span key={c} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      SENSITIVE_CAPABILITIES.has(c)
                        ? "border-[var(--pc-state-warning)] text-[var(--pc-state-warning)]"
                        : "border-[var(--pc-border-subtle)] text-[var(--pc-text-secondary)]"
                    }`}>{c}</span>
                  ))}
                </div>
                {sensitive.length > 0 && (
                  <div className="text-[11px] text-[var(--pc-state-warning)] flex items-center gap-1">
                    <AlertTriangle size={10} /> {sensitive.length} sensitive capability requires owner approval at install
                  </div>
                )}
              </div>
            </Glass>
          );
        })}
      </div>

      {/* Install consent dialog */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
          <Glass>
            <div className="max-w-lg w-full p-5 flex flex-col gap-3">
              <h2 className="font-semibold text-[15px]">Install {pending.name}?</h2>
              <p className="text-[13px] text-[var(--pc-text-secondary)]">{pending.description}</p>
              <div className="border-t border-[var(--pc-border-subtle)] pt-3">
                <h3 className="text-[12px] font-medium mb-1">This plugin will get the following permissions:</h3>
                <ul className="space-y-1">
                  {pending.capabilities.map((c) => (
                    <li key={c} className="text-[12px] flex items-center gap-2">
                      {SENSITIVE_CAPABILITIES.has(c)
                        ? <AlertTriangle size={12} className="text-[var(--pc-state-warning)]" />
                        : <ShieldCheck size={12} className="text-[var(--pc-text-secondary)]" />}
                      <span className="font-mono">{c}</span>
                      {SENSITIVE_CAPABILITIES.has(c) && <Badge variant="warning">SENSITIVE</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--pc-border-subtle)] pt-3">
                <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
                <Button onClick={confirmInstall}>Approve and install</Button>
              </div>
            </div>
          </Glass>
        </div>
      )}
    </div>
  );
}
