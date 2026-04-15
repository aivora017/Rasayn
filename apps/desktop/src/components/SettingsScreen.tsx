// F5b: Settings screen — overwrites the placeholder shop_local row seeded
// by db::ensure_default_shop (F1). Owner must complete this before any
// GST invoice can be issued (placeholder GSTIN "00AAAAA0000A0Z0" is
// intentionally invalid per GSTR-1 regex).
//
// Keyboard: F8 opens this screen. Alt+S submits. Esc cancels dirty edits.
import { useCallback, useEffect, useState } from "react";
import { shopGetRpc, shopUpdateRpc, type Shop, type ShopUpdateInput } from "../lib/ipc.js";

const SHOP_ID = "shop_local";
const PLACEHOLDER_GSTIN = "00AAAAA0000A0Z0";
const PLACEHOLDER_LICENSE = "PENDING";

// Client-side structural GSTIN check.
// Format: 2 digits (state) + 10 PAN chars + 1 entity + "Z" + 1 checksum.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const STATE_CODE_RE = /^[0-9]{2}$/;

type FormState = Omit<ShopUpdateInput, "id">;

const EMPTY: FormState = {
  name: "",
  gstin: "",
  stateCode: "",
  retailLicense: "",
  address: "",
};

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
      if (!s) {
        setErr("shop_local row missing — run app once to seed it.");
        return;
      }
      setLoaded(s);
      setForm(toForm(s));
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const placeholder =
    loaded?.gstin === PLACEHOLDER_GSTIN || loaded?.retailLicense === PLACEHOLDER_LICENSE;

  const dirty = loaded
    ? form.name !== loaded.name ||
      form.gstin !== loaded.gstin ||
      form.stateCode !== loaded.stateCode ||
      form.retailLicense !== loaded.retailLicense ||
      form.address !== loaded.address
    : false;

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErr(null);
      const v = validate(form);
      if (v) {
        setErr(v);
        return;
      }
      setBusy(true);
      try {
        const updated = await shopUpdateRpc({ id: SHOP_ID, ...form });
        setLoaded(updated);
        setForm(toForm(updated));
        setSavedAt(new Date().toISOString());
      } catch (ex) {
        setErr(String(ex));
      } finally {
        setBusy(false);
      }
    },
    [form],
  );

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

  const field = <K extends keyof FormState>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section className="settings-screen" data-testid="settings-screen">
      <h2>Shop Settings</h2>
      {placeholder && (
        <div className="banner banner-warn" data-testid="placeholder-warn">
          First-run setup required. The shop was seeded with placeholder values so the
          app could boot; GST invoicing is blocked until you complete the fields below.
        </div>
      )}
      {err && (
        <div className="banner banner-err" data-testid="settings-err">
          {err}
        </div>
      )}
      {savedAt && !err && !dirty && (
        <div className="banner banner-ok" data-testid="settings-saved">
          Saved at {savedAt}.
        </div>
      )}
      <form onSubmit={onSubmit} className="settings-form">
        <label>
          <span>Shop name</span>
          <input
            name="name"
            data-testid="f-name"
            value={form.name}
            onChange={field("name")}
            maxLength={120}
            autoFocus
          />
        </label>
        <label>
          <span>GSTIN</span>
          <input
            name="gstin"
            data-testid="f-gstin"
            value={form.gstin}
            onChange={(e) =>
              setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase().slice(0, 15) }))
            }
            maxLength={15}
            placeholder="27ABCDE1234F1Z5"
            spellCheck={false}
          />
        </label>
        <label>
          <span>State code</span>
          <input
            name="stateCode"
            data-testid="f-state"
            value={form.stateCode}
            onChange={(e) =>
              setForm((f) => ({ ...f, stateCode: e.target.value.replace(/\D/g, "").slice(0, 2) }))
            }
            maxLength={2}
            placeholder="27"
          />
        </label>
        <label>
          <span>Retail drug-license (Form 20/21)</span>
          <input
            name="retailLicense"
            data-testid="f-license"
            value={form.retailLicense}
            onChange={field("retailLicense")}
            maxLength={60}
            placeholder="21B/MH/KL/123456"
          />
        </label>
        <label>
          <span>Address</span>
          <textarea
            name="address"
            data-testid="f-address"
            value={form.address}
            onChange={field("address")}
            rows={3}
            maxLength={400}
          />
        </label>
        <div className="form-actions">
          <button type="submit" data-testid="f-save" disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save (Alt+S)"}
          </button>
          <button
            type="button"
            data-testid="f-reset"
            onClick={() => loaded && setForm(toForm(loaded))}
            disabled={busy || !dirty}
          >
            Reset (Esc)
          </button>
        </div>
      </form>
      <p className="muted">
        Shop id: <code>{loaded?.id ?? "—"}</code> &middot; created{" "}
        <code>{loaded?.createdAt ?? "—"}</code>
      </p>
    </section>
  );
}

export default SettingsScreen;
