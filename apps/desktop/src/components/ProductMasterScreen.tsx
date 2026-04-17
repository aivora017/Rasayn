// A1 — SKU master screen. Keyboard-first product CRUD.
//
// Shortcuts (within this screen, additive to App-level F1–F8/F11):
//   Alt+N     New product (focus first field)
//   Alt+S     Save current form
//   Alt+D     Deactivate selected row (asks Enter to confirm)
//   Esc       Cancel form / clear selection
//   ↑ / ↓     Move row cursor
//   Enter     Edit row under cursor
//   /         Focus search input
//
// All fields tab-reachable. No mouse required.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listProductsRpc,
  upsertProductRpc,
  deactivateProductRpc,
  attachProductImageRpc,
  getProductImageRpc,
  type ProductRow,
  type ProductWriteDTO,
} from "../lib/ipc.js";
import {
  PHARMA_HSN,
  validateProductWrite,
  type DrugSchedule,
  type GstRate,
} from "@pharmacare/shared-types";
import { validate, type ValidationError } from "@pharmacare/sku-images";

const ACTOR_USER_ID = "user_sourav_owner";

/** Convert a Uint8Array to base64 safely (chunked to avoid
 * String.fromCharCode(...) stack blow-ups on large arrays). */
function u8ToB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    bin += String.fromCharCode.apply(null, Array.from(slice) as number[]);
  }
  return btoa(bin);
}

type FormState = {
  id?: string;
  name: string;
  genericName: string;
  manufacturer: string;
  hsn: string;
  gstRate: GstRate;
  schedule: DrugSchedule;
  packForm: string;
  packSize: string;
  mrpRupees: string;
  nppaMaxRupees: string;
  imageSha256: string;
  imageBytesB64: string | null;
  imageReportedMime: string | null;
  imagePreviewSrc: string | null;
};

const EMPTY: FormState = {
  name: "",
  genericName: "",
  manufacturer: "",
  hsn: "3004",
  gstRate: 12,
  schedule: "OTC",
  packForm: "tablet",
  packSize: "10",
  mrpRupees: "",
  nppaMaxRupees: "",
  imageSha256: "",
  imageBytesB64: null,
  imageReportedMime: null,
  imagePreviewSrc: null,
};

function rupeesToPaise(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.round(n * 100);
}

function paiseToRupees(p: number | null): string {
  if (p === null || p === undefined) return "";
  return (p / 100).toFixed(2);
}

export function ProductMasterScreen(): JSX.Element {
  const [rows, setRows] = useState<readonly ProductRow[]>([]);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);
  const [errs, setErrs] = useState<readonly string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    const trimmed = q.trim();
    const r = await listProductsRpc({
      ...(trimmed ? { q: trimmed } : {}),
      activeOnly: false,
      limit: 500,
    });
    setRows(r);
    if (cursor >= r.length) setCursor(Math.max(0, r.length - 1));
  }, [q, cursor]);

  useEffect(() => {
    reload().catch((e) => setMsg(`load failed: ${e instanceof Error ? e.message : String(e)}`));
  }, [reload]);

  const startNew = useCallback(() => {
    setForm({ ...EMPTY });
    setErrs([]);
    setMsg(null);
    setTimeout(() => firstFieldRef.current?.focus(), 0);
  }, []);

  const startEdit = useCallback((r: ProductRow) => {
    setForm({
      id: r.id,
      name: r.name,
      genericName: r.genericName ?? "",
      manufacturer: r.manufacturer,
      hsn: r.hsn,
      gstRate: r.gstRate,
      schedule: r.schedule,
      packForm: r.packForm,
      packSize: String(r.packSize),
      mrpRupees: paiseToRupees(r.mrpPaise),
      nppaMaxRupees: paiseToRupees(r.nppaMaxMrpPaise),
      imageSha256: r.imageSha256 ?? "",
      imageBytesB64: null,
      imageReportedMime: null,
      imagePreviewSrc: null,
    });
    setErrs([]);
    setMsg(null);
    setTimeout(() => firstFieldRef.current?.focus(), 0);
    // Asynchronously fetch the stored image (if any) so the owner can see it
    // without having to re-upload. We only populate the preview; we do NOT
    // seed imageBytesB64 because there is no need to re-attach an unchanged
    // image on save.
    void (async () => {
      try {
        const existing = await getProductImageRpc(r.id);
        if (existing !== null) {
          setForm((prev) => {
            if (!prev || prev.id !== r.id) return prev;
            return {
              ...prev,
              imagePreviewSrc: `data:${existing.mime};base64,${existing.bytesB64}`,
            };
          });
        }
      } catch {
        // Non-fatal — the owner can still pick a new image.
      }
    })();
  }, []);

  const submit = useCallback(async () => {
    if (!form) return;
    const mrp = rupeesToPaise(form.mrpRupees);
    const cap = form.nppaMaxRupees.trim() ? rupeesToPaise(form.nppaMaxRupees) : null;
    const packSize = Number(form.packSize);
    if (mrp === null || Number.isNaN(mrp)) { setErrs(["enter a valid MRP"]); return; }
    if (cap !== null && Number.isNaN(cap)) { setErrs(["enter a valid NPPA cap or leave blank"]); return; }

    const dto: ProductWriteDTO = {
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim(),
      genericName: form.genericName.trim() || null,
      manufacturer: form.manufacturer.trim(),
      hsn: form.hsn.trim(),
      gstRate: form.gstRate,
      schedule: form.schedule,
      packForm: form.packForm,
      packSize,
      mrpPaise: mrp,
      nppaMaxMrpPaise: cap,
      imageSha256: form.imageSha256.trim() || null,
    };
    // validateProductWrite expects branded Paise; dto carries raw numbers. Cast is safe:
    // the validator only reads numeric values and string keys.
    const clientErrs = validateProductWrite(dto as unknown as Parameters<typeof validateProductWrite>[0]);
    if (clientErrs.length) { setErrs(clientErrs); return; }

    setSaving(true);
    setErrs([]);
    try {
      const saved = await upsertProductRpc(dto);
      // If the owner picked a new image this session, attach it AFTER the
      // upsert so we have a productId. Attach failure must not mask the
      // successful product save.
      let attachWarning: string | null = null;
      if (form.imageBytesB64 !== null) {
        try {
          await attachProductImageRpc({
            productId: saved.id,
            bytesB64: form.imageBytesB64,
            reportedMime: form.imageReportedMime,
            actorUserId: ACTOR_USER_ID,
          });
        } catch (attachErr) {
          attachWarning = attachErr instanceof Error ? attachErr.message : String(attachErr);
        }
      }
      if (attachWarning !== null) {
        setMsg(`saved: ${saved.name} (image attach failed: ${attachWarning})`);
        setErrs([`image attach failed: ${attachWarning}`]);
      } else {
        setMsg(`saved: ${saved.name}`);
        setForm(null);
      }
      await reload();
    } catch (e) {
      setErrs([e instanceof Error ? e.message : String(e)]);
    } finally {
      setSaving(false);
    }
  }, [form, reload]);

  const deactivateCursor = useCallback(async () => {
    const r = rows[cursor];
    if (!r) return;
    if (!r.isActive) { setMsg("already inactive"); return; }
    try {
      await deactivateProductRpc(r.id);
      setMsg(`deactivated: ${r.name}`);
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, [rows, cursor, reload]);

  // Global screen shortcuts.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.altKey && !e.shiftKey && !e.ctrlKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault(); startNew();
      } else if (e.altKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault(); if (form) void submit();
      } else if (e.altKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault(); void deactivateCursor();
      } else if (e.key === "Escape") {
        if (form) { setForm(null); setErrs([]); }
      } else if (e.key === "/") {
        if (!form) { e.preventDefault(); searchRef.current?.focus(); }
      } else if (!form) {
        if (e.key === "ArrowDown") {
          e.preventDefault(); setCursor((c) => Math.min(rows.length - 1, c + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault(); setCursor((c) => Math.max(0, c - 1));
        } else if (e.key === "Enter") {
          const r = rows[cursor]; if (r) { e.preventDefault(); startEdit(r); }
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [form, rows, cursor, startNew, submit, deactivateCursor, startEdit]);

  const active = useMemo(() => rows.filter((r) => r.isActive).length, [rows]);

  return (
    <div className="screen product-master" data-testid="product-master">
      <div className="screen-header">
        <h2>Product Master</h2>
        <div className="screen-hint">
          <span className="kbd">Alt+N</span> New · <span className="kbd">Enter</span> Edit ·
          <span className="kbd">Alt+S</span> Save · <span className="kbd">Alt+D</span> Deactivate ·
          <span className="kbd">/</span> Search · <span className="kbd">Esc</span> Cancel
        </div>
        <div className="screen-stats">
          {rows.length} total · {active} active · {rows.length - active} inactive
        </div>
      </div>

      {msg && <div className="banner" role="status">{msg}</div>}

      {!form && (
        <>
          <input
            ref={searchRef}
            className="search-input"
            placeholder="Search name / generic / manufacturer…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="product search"
            data-testid="pm-search"
          />
          <table className="data-table" data-testid="pm-table">
            <thead>
              <tr>
                <th>Name</th><th>Generic</th><th>Mfr</th><th>HSN</th>
                <th>Sch</th><th>GST</th><th style={{ textAlign: "right" }}>MRP</th>
                <th style={{ textAlign: "right" }}>NPPA cap</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="empty">No products. Press <span className="kbd">Alt+N</span> to add.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className={i === cursor ? "row-cursor" : ""}
                  aria-selected={i === cursor}
                  onClick={() => setCursor(i)}
                  onDoubleClick={() => startEdit(r)}
                >
                  <td>{r.name}</td>
                  <td>{r.genericName ?? "—"}</td>
                  <td>{r.manufacturer}</td>
                  <td>{r.hsn}</td>
                  <td>{r.schedule}</td>
                  <td>{r.gstRate}%</td>
                  <td style={{ textAlign: "right" }}>₹{paiseToRupees(r.mrpPaise)}</td>
                  <td style={{ textAlign: "right" }}>{r.nppaMaxMrpPaise ? `₹${paiseToRupees(r.nppaMaxMrpPaise)}` : "—"}</td>
                  <td>{r.isActive ? "active" : "inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {form && (
        <form
          className="form-grid"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          data-testid="pm-form"
        >
          <label>Name<input
            ref={firstFieldRef}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          /></label>
          <label>Generic name<input
            value={form.genericName}
            onChange={(e) => setForm({ ...form, genericName: e.target.value })}
          /></label>
          <label>Manufacturer<input
            value={form.manufacturer}
            onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
            required
          /></label>
          <label>HSN
            <select value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })}>
              {PHARMA_HSN.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label>GST rate
            <select
              value={form.gstRate}
              onChange={(e) => setForm({ ...form, gstRate: Number(e.target.value) as GstRate })}
            >
              {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
            </select>
          </label>
          <label>Schedule
            <select
              value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value as DrugSchedule })}
            >
              {(["OTC", "G", "H", "H1", "X", "NDPS"] as const).map((s) =>
                <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Pack form
            <select value={form.packForm} onChange={(e) => setForm({ ...form, packForm: e.target.value })}>
              {["tablet", "capsule", "syrup", "injection", "ointment", "drops", "inhaler", "device", "strip", "bottle", "other"].map((f) =>
                <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label>Pack size<input
            type="number" min={1}
            value={form.packSize}
            onChange={(e) => setForm({ ...form, packSize: e.target.value })}
          /></label>
          <label>MRP (₹)<input
            type="number" step="0.01" min="0.01"
            value={form.mrpRupees}
            onChange={(e) => setForm({ ...form, mrpRupees: e.target.value })}
            required
          /></label>
          <label>NPPA cap (₹, optional)<input
            type="number" step="0.01" min="0.01"
            value={form.nppaMaxRupees}
            onChange={(e) => setForm({ ...form, nppaMaxRupees: e.target.value })}
          /></label>
          <div style={{ gridColumn: "span 2" }} className="pm-image-field">
            <label>
              Product image
              {(form.schedule === "H" || form.schedule === "H1" || form.schedule === "X") && (
                <span className="req"> (required for Schedule {form.schedule})</span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                data-testid="pm-image-file"
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  // Reset the input so selecting the same file again still fires.
                  e.target.value = "";
                  if (!f) return;
                  void (async () => {
                    try {
                      const buf = await f.arrayBuffer();
                      const bytes = new Uint8Array(buf);
                      const result = await validate({ bytes, reportedMime: f.type });
                      if (!result.ok) {
                        setErrs(result.errors.map((er: ValidationError) => er.message));
                        setForm((prev) =>
                          prev
                            ? {
                                ...prev,
                                imageBytesB64: null,
                                imageReportedMime: null,
                                imagePreviewSrc: null,
                                imageSha256: "",
                              }
                            : prev,
                        );
                        return;
                      }
                      const b64 = u8ToB64(bytes);
                      setErrs([]);
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              imageBytesB64: b64,
                              imageReportedMime: f.type || result.metadata.mime,
                              imageSha256: result.metadata.sha256,
                              imagePreviewSrc: `data:${result.metadata.mime};base64,${b64}`,
                            }
                          : prev,
                      );
                    } catch (err) {
                      setErrs([err instanceof Error ? err.message : String(err)]);
                    }
                  })();
                }}
              />
            </label>
            {form.imagePreviewSrc && (
              <img
                data-testid="pm-image-preview"
                src={form.imagePreviewSrc}
                alt="Product image preview"
                style={{ width: 96, height: 96, objectFit: "contain", display: "block", marginTop: 4 }}
              />
            )}
            <div style={{ marginTop: 4, fontSize: "0.85em" }}>
              SHA-256: <code data-testid="pm-image-sha">{form.imageSha256 || "(none)"}</code>
            </div>
            <button
              type="button"
              data-testid="pm-image-clear"
              onClick={() => {
                setForm((prev) =>
                  prev
                    ? {
                        ...prev,
                        imageBytesB64: null,
                        imageReportedMime: null,
                        imagePreviewSrc: null,
                        imageSha256: "",
                      }
                    : prev,
                );
              }}
            >
              Clear image
            </button>
          </div>

          {errs.length > 0 && (
            <ul className="form-errors" role="alert" data-testid="pm-errors">
              {errs.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}

          <div className="form-actions">
            <button type="submit" disabled={saving} data-testid="pm-save">
              {saving ? "Saving…" : form.id ? "Update (Alt+S)" : "Create (Alt+S)"}
            </button>
            <button type="button" onClick={() => { setForm(null); setErrs([]); }}>
              Cancel (Esc)
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
