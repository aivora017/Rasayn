// F5b: Settings screen — overwrites the placeholder shop_local row.
// Owner must complete this before any GST invoice can be issued
// (placeholder GSTIN "00AAAAA0000A0Z0" is intentionally invalid).
//
// Keyboard: F8 opens this screen. Alt+S submits. Esc cancels dirty edits.

import { useCallback, useEffect, useState } from "react";
import { Save, RotateCcw, AlertCircle, CheckCircle2, Store, ShieldCheck } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import { shopGetRpc, shopUpdateRpc, type Shop, type ShopUpdateInput } from "../lib/ipc.js";

const SHOP_ID = "shop_local";
const PLACEHOLDER_GSTIN = "00AAAAA0000A0Z0";
const PLACEHOLDER_LICENSE = "PENDING";

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const STATE_CODE_RE = /^[0-9]{2}$/;

type FormState = Omit<ShopUpdateInput, "id">;

const EMPTY: FormState = { name: "", gstin: "", stateCode: "", retailLicense: "", address: "" };

function toForm(s: Shop): FormState {
  return {
    name: s.name,
    gstin: s.gstin,
    stateCode: s.stateCode,
    retailLicense: s.retailLicense,
    address: s.address,
  };
}

function validate(f: FormState): string | null {
  if (!f.name.trim()) return "Shop name is required.";
  if (!GSTIN_RE.test(f.gstin))
    return "GSTIN must match 22ABCDE1234F1Z5 format (15 chars: 2 digits, 5 letters, 4 digits, 1 letter, 1 digit/letter, 'Z', 1 alnum).";
  if (!STATE_CODE_RE.test(f.stateCode)) return "State code must be exactly 2 digits (e.g., 27 = Maharashtra).";
  if (f.stateCode !== f.gstin.slice(0, 2))
    return "State code must match the first 2 digits of GSTIN.";
  if (!f.retailLicense.trim() || f.retailLicense.trim() === PLACEHOLDER_LICENSE)
    return "Retail drug-license number is required (Form 20/21).";
  if (!f.address.trim()) return "Shop address is required.";
  return null;
}

export function SettingsScreen(): React.ReactElement {
  const [loaded, setLoaded] = useState<Shop | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const s = await shopGetRpc(SHOP_ID);
      if (!s) { setErr("shop_local row missing — run app once to seed it."); return; }
      setLoaded(s); setForm(toForm(s));
    } catch (e) { setErr(String(e)); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const placeholder =
    loaded?.gstin === PLACEHOLDER_GSTIN || loaded?.retailLicense === PLACEHOLDER_LICENSE;

  const dirty = loaded
    ? form.name !== loaded.name || form.gstin !== loaded.gstin ||
      form.stateCode !== loaded.stateCode || form.retailLicense !== loaded.retailLicense ||
      form.address !== loaded.address
    : false;

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const v = validate(form);
    if (v) { setErr(v); return; }
    setBusy(true);
    try {
      const updated = await shopUpdateRpc({ id: SHOP_ID, ...form });
      setLoaded(updated); setForm(toForm(updated));
      setSavedAt(new Date().toISOString());
    } catch (ex) { setErr(String(ex)); }
    finally { setBusy(false); }
  }, [form]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void onSubmit(new Event("submit") as unknown as React.FormEvent);
      }
      if (e.key === "Escape" && dirty && loaded) {
        e.preventDefault();
        setForm(toForm(loaded));
        setErr(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, loaded, onSubmit]);

  return (
    <section data-testid="settings-screen" className="mx-auto max-w-[720px] p-4 lg:p-6 text-[var(--pc-text-primary)]">
      <header className="mb-4 flex items-baseline gap-3">
        <h1 className="text-[22px] font-medium leading-tight inline-flex items-center gap-2">
          <Store size={18} aria-hidden /> Shop settings
        </h1>
        {loaded && !placeholder ? <Badge variant="success">configured</Badge> : <Badge variant="warning">first-run</Badge>}
      </header>

      {placeholder && (
        <Glass depth={1} tone="saffron" className="p-4 mb-3" data-testid="placeholder-warn">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} aria-hidden style={{ color: "var(--pc-state-warning)" }} />
            <div>
              <h2 className="text-[14px] font-medium text-[var(--pc-state-warning)]">First-run setup required</h2>
              <p className="mt-1 text-[12px] text-[var(--pc-text-secondary)]">
                The shop was seeded with placeholder values so the app could boot; GST invoicing is blocked until you complete the fields below.
              </p>
            </div>
          </div>
        </Glass>
      )}

      {err && (
        <Glass depth={1} tone="danger" className="p-3 mb-3" data-testid="settings-err">
          <div className="flex items-start gap-2 text-[12px] text-[var(--pc-state-danger)]">
            <AlertCircle size={14} aria-hidden /> <span>{err}</span>
          </div>
        </Glass>
      )}

      {savedAt && !err && !dirty && (
        <Glass depth={1} className="p-3 mb-3" data-testid="settings-saved">
          <div className="flex items-center gap-2 text-[12px] text-[var(--pc-state-success)]">
            <CheckCircle2 size={14} aria-hidden /> <span>Saved at {savedAt}.</span>
          </div>
        </Glass>
      )}

      <Glass depth={1} className="p-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Shop name">
            <Input
              data-testid="f-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={120}
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
            <Field label="GSTIN" hint="15 chars: state-code + PAN + entity + Z + checksum">
              <Input
                data-testid="f-gstin"
                value={form.gstin}
                onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase().slice(0, 15) }))}
                maxLength={15}
                placeholder="27ABCDE1234F1Z5"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
            <Field label="State code" hint="first 2 digits of GSTIN">
              <Input
                data-testid="f-state"
                value={form.stateCode}
                onChange={(e) => setForm((f) => ({ ...f, stateCode: e.target.value.replace(/\D/g, "").slice(0, 2) }))}
                maxLength={2}
                placeholder="27"
                className="font-mono"
              />
            </Field>
          </div>

          <Field label="Retail drug-license (Form 20/21)">
            <Input
              data-testid="f-license"
              value={form.retailLicense}
              onChange={(e) => setForm((f) => ({ ...f, retailLicense: e.target.value }))}
              maxLength={60}
              placeholder="21B/MH/KL/123456"
              leading={<ShieldCheck size={14} />}
            />
          </Field>

          <Field label="Address">
            <textarea
              name="address"
              data-testid="f-address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              rows={3}
              maxLength={400}
              className="w-full rounded-[var(--pc-radius-md)] border border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)] p-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--pc-brand-primary)]"
            />
          </Field>

          <div className="flex items-center gap-2 pt-2 border-t border-[var(--pc-border-subtle)]">
            <Button type="submit" data-testid="f-save" disabled={busy || !dirty} leadingIcon={<Save size={14} />} shortcut="Alt+S">
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="f-reset"
              onClick={() => loaded && setForm(toForm(loaded))}
              disabled={busy || !dirty}
              leadingIcon={<RotateCcw size={14} />}
              shortcut="Esc"
            >
              Reset
            </Button>
          </div>
        </form>
      </Glass>

      <p className="mt-3 text-[11px] text-[var(--pc-text-tertiary)]">
        Shop id: <code className="font-mono">{loaded?.id ?? "—"}</code> · created <code className="font-mono">{loaded?.createdAt ?? "—"}</code>
      </p>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-[var(--pc-text-primary)]">{label}</span>
      {hint && <span className="text-[10px] text-[var(--pc-text-tertiary)]">{hint}</span>}
      {children}
    </label>
  );
}

export default SettingsScreen;
