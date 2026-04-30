// LicenseScreen — view + paste + activate licence keys.
import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Sparkles, AlertTriangle, CheckCircle2, Clock, Cpu, Copy } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import { licenseSaveRpc, licenseGetRpc, licenseClearRpc } from "../lib/ipc.js";
import {
  parseKey, validateLicense, issueLicense, trialStateFrom,
  EDITION_FLAGS, PRESET_BUNDLES,
  type EditionFlag, type ValidationResult,
} from "@pharmacare/license";

const DEMO_FP = { fullHash: "deadbeef".repeat(8), shortHash: "deadbe" };

export default function LicenseScreen(): React.ReactElement {
  const [inputKey, setInputKey] = useState("");
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  // S16.3 — boot from persisted license on mount.
  useEffect(() => {
    void (async () => {
      try {
        const persisted = await licenseGetRpc();
        if (!persisted) return;
        const v = validateLicense({ licenseKey: persisted.keyText, shopFingerprint: DEMO_FP });
        setValidation(v);
        if (v.valid) {
          setLicenseKey(persisted.keyText);
          setInputKey(persisted.keyText);
        }
      } catch {
        // no-op — first run
      }
    })();
  }, []);

  const onActivate = useCallback(async () => {
    setErr(null);
    try {
      const parts = parseKey(inputKey.trim());     // throws if malformed
      const v = validateLicense({ licenseKey: inputKey.trim(), shopFingerprint: DEMO_FP });
      setValidation(v);
      if (v.valid) {
        setLicenseKey(inputKey.trim());
        // Persist the license to the singleton row.
        try {
          await licenseSaveRpc({
            keyText: inputKey.trim(),
            editionFlags: parts.editionFlags,
            expiryIso: new Date(parts.expiryDate + "T00:00:00.000Z").toISOString(),
            fingerprint: DEMO_FP.fullHash,
          });
        } catch {
          // Persistence failure is non-fatal — license is still valid in-memory.
        }
      } else {
        setErr(v.reason ?? "Invalid licence");
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [inputKey]);

  const onClearLicense = useCallback(async () => {
    try {
      await licenseClearRpc();
      setLicenseKey(null);
      setValidation(null);
      setInputKey("");
      setErr(null);
    } catch (e) {
      setErr(`Failed to clear license: ${String(e)}`);
    }
  }, []);

  const startTrial = useCallback(() => {
    const k = issueLicense({ preset: "free", shopFingerprintShort: DEMO_FP.shortHash, validForDays: 30 });
    const v = validateLicense({ licenseKey: k.raw, shopFingerprint: DEMO_FP });
    setLicenseKey(k.raw); setValidation(v); setErr(null);
  }, []);

  const trial = useMemo(() => validation ? trialStateFrom(validation) : null, [validation]);
  const allFlags = Object.keys(EDITION_FLAGS) as EditionFlag[];

  return (
    <div className="screen-shell flex flex-col gap-4 p-6 max-w-3xl mx-auto" data-screen="license">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <KeyRound size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Licence</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">Activate · view edition · check expiry</p>
          </div>
        </div>
        {validation?.valid && trial?.isTrial && (
          <Badge variant="warning"><Sparkles size={10} /> TRIAL · {trial.daysRemaining}d left</Badge>
        )}
        {validation?.valid && !trial?.isTrial && <Badge variant="success">ACTIVE</Badge>}
      </header>

      {err && (
        <Glass>
          <div className="p-3 flex gap-2 text-[13px] text-[var(--pc-state-danger)]">
            <AlertTriangle size={16} className="mt-0.5" /> {err}
          </div>
        </Glass>
      )}

      {!licenseKey && (
        <Glass>
          <div className="p-4 flex flex-col gap-3">
            <h2 className="font-medium">Activate licence</h2>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Paste your licence key (format: <code>PCPR-YYYY-XXXX-XXXX-XXXX-XXXX-XXXX-CHECK</code>)
              or start a 30-day free trial.
            </p>
            <Input
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="PCPR-2027-AAAA-BBBB-CCCC-DDDD-EEEE-1234"
              className="font-mono"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={startTrial}><Sparkles size={14} /> Start 30-day trial</Button>
              <Button onClick={onActivate} disabled={!inputKey.trim()}><CheckCircle2 size={14} /> Activate</Button>
            </div>
          </div>
        </Glass>
      )}

      {licenseKey && validation?.valid && (
        <>
          <Glass>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Active licence</h2>
                <Button variant="ghost" onClick={() => { navigator.clipboard?.writeText(licenseKey); }}>
                  <Copy size={12} /> Copy key
                </Button>
              </div>
              <div className="font-mono text-[12px] p-2 rounded border border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)]">
                {licenseKey}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
                <div>
                  <div className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Expires</div>
                  <div className="font-mono">{validation.expiryDate}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Days left</div>
                  <div className="font-mono">
                    <Clock size={12} className="inline mr-1" />{validation.daysToExpiry}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Hardware FP</div>
                  <div className="font-mono"><Cpu size={12} className="inline mr-1" />{DEMO_FP.shortHash}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">Status</div>
                  {validation.inGrace
                    ? <Badge variant="warning">IN GRACE · hardware change</Badge>
                    : <Badge variant="success">VALID</Badge>}
                </div>
              </div>
            </div>
          </Glass>

          <Glass>
            <div className="p-4 flex flex-col gap-2">
              <h2 className="font-medium">Features unlocked ({trial?.featuresUnlocked.length ?? 0})</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {allFlags.map((f) => {
                  const on = validation.hasFlag(f);
                  return (
                    <span key={f}
                      className={`text-[11px] font-mono px-2 py-1 rounded border ${
                        on ? "border-[var(--pc-state-success)] text-[var(--pc-state-success)]"
                           : "border-[var(--pc-border-subtle)] text-[var(--pc-text-tertiary)] line-through opacity-50"
                      }`}>
                      {on ? "✓" : "—"} {f}
                    </span>
                  );
                })}
              </div>
            </div>
          </Glass>

          <Glass>
            <div className="p-3 text-[12px] text-[var(--pc-text-secondary)]">
              <strong>Available editions:</strong> Free (30-day trial · core only) ·
              Starter (₹14,999 perpetual + ₹4,999 AMC · core POS + GST) ·
              Pro (₹999/mo · adds AI Copilot + WhatsApp + OCR + Voice) ·
              Enterprise (custom · adds multi-store + plugins + cold-chain + AR shelf + digital twin)
            </div>
          </Glass>

          <Glass>
            <div className="p-3 flex justify-end">
              <Button variant="ghost" onClick={() => { setLicenseKey(null); setValidation(null); setInputKey(""); }}>
                Replace licence key
              </Button>
            </div>
          </Glass>
        </>
      )}
    </div>
  );
}
