// UpdateCheckerScreen — fetches manifest, shows update banner.
import { useCallback, useState } from "react";
import { Download, RefreshCw, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  checkForUpdate, validateManifest,
  type UpdateManifest, type UpdateCheckResult, type ReleaseChannel,
} from "@pharmacare/auto-update";

const CURRENT_VERSION = "0.1.0";    // wired to package.json in real install
const MANIFEST_URL = "https://updates.pharmacare.in/manifest.json";

// Demo manifest for sandbox display
const DEMO_MANIFEST: UpdateManifest = {
  product: "PharmaCare",
  latest: { stable: "0.2.0", beta: "0.3.0-beta.1", nightly: "0.4.0-nightly.20260427" },
  releases: [
    { version: "0.2.0", channel: "stable", publishedAt: "2026-04-15",
      notes: "## What's new\n- Faster billing (sub-2s on Win7)\n- Khata aging buckets fix\n- DPDP DSR queue UI",
      assets: [{ platform: "windows-x86_64", url: "https://x/y.msi", sha256: "deadbeef".repeat(8), sizeBytes: 95_000_000, signature: "sig" }] },
    { version: "0.3.0-beta.1", channel: "beta", publishedAt: "2026-04-25",
      notes: "## Beta — 0.3.0\n- Voice billing (Web Speech API)\n- AI Copilot mock LLM upgrade\n- Migration import from Vyapar",
      assets: [{ platform: "windows-x86_64", url: "https://x/y.msi", sha256: "ab".repeat(32), sizeBytes: 105_000_000, signature: "sig" }] },
  ],
  generatedAt: "2026-04-28T12:00:00Z",
};

export default function UpdateCheckerScreen(): React.ReactElement {
  const [channel, setChannel] = useState<ReleaseChannel>("stable");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const check = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      // In production: fetch(MANIFEST_URL)
      // Sandbox: use demo
      const manifest = DEMO_MANIFEST;
      validateManifest(manifest);
      const r = checkForUpdate({
        currentVersion: CURRENT_VERSION,
        platform: "windows-x86_64",
        channel,
        manifest,
      });
      setResult(r);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }, [channel]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6 max-w-3xl mx-auto" data-screen="update-checker">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <RefreshCw size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Updates</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Current version: <span className="font-mono">{CURRENT_VERSION}</span> · Channel: {channel}
            </p>
          </div>
        </div>
      </header>

      {err && (
        <Glass>
          <div className="p-3 flex gap-2 text-[13px] text-[var(--pc-state-danger)]">
            <AlertTriangle size={16} /> {err}
          </div>
        </Glass>
      )}

      <Glass>
        <div className="p-4 flex flex-col gap-3">
          <h2 className="font-medium">Check for updates</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Channel:</span>
            {(["stable", "beta", "nightly"] as ReleaseChannel[]).map((c) => (
              <Button key={c} variant={channel === c ? "default" : "ghost"} onClick={() => setChannel(c)}>
                {c}
              </Button>
            ))}
            <Button onClick={check} disabled={busy} className="ml-auto">
              {busy ? "Checking…" : <><RefreshCw size={14} /> Check now</>}
            </Button>
          </div>
          <p className="text-[11px] text-[var(--pc-text-tertiary)]">
            Manifest URL: <code>{MANIFEST_URL}</code>
          </p>
        </div>
      </Glass>

      {result?.hasUpdate === false && (
        <Glass>
          <div className="p-4 flex items-center gap-3">
            <CheckCircle2 size={24} className="text-[var(--pc-state-success)]" />
            <div>
              <h3 className="font-medium">You're up to date</h3>
              <p className="text-[12px] text-[var(--pc-text-secondary)]">
                Running latest version on {channel} channel.
              </p>
            </div>
          </div>
        </Glass>
      )}

      {result?.hasUpdate === true && (
        <Glass>
          <div className="p-4 flex flex-col gap-3" data-testid="update-banner">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Download size={20} className="text-[var(--pc-brand-primary)]" />
                <h2 className="font-semibold text-[16px]">Update available</h2>
              </div>
              {result.mandatory && <Badge variant="danger">MANDATORY</Badge>}
              {!result.mandatory && <Badge variant="info">{result.channel}</Badge>}
            </div>
            <div className="grid grid-cols-3 gap-3 text-[13px]">
              <div>
                <div className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Current</div>
                <div className="font-mono">{result.current}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Target</div>
                <div className="font-mono text-[var(--pc-state-success)]">{result.target}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Size</div>
                <div className="font-mono">{(result.asset.sizeBytes / 1024 / 1024).toFixed(1)} MB</div>
              </div>
            </div>
            {result.notes && (
              <div className="text-[12px] p-3 rounded border border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)] whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                {result.notes}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => window.open(result.asset.url, "_blank")}>
                <Download size={14} /> Download {result.target}
                <ExternalLink size={10} />
              </Button>
            </div>
          </div>
        </Glass>
      )}
    </div>
  );
}
