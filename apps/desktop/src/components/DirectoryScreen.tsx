import { useCallback, useEffect, useState } from "react";
import {
  searchCustomersRpc, upsertCustomerRpc,
  searchDoctorsRpc, upsertDoctorRpc,
  createPrescriptionRpc, listPrescriptionsRpc,
  type Customer, type Doctor, type Prescription,
} from "../lib/ipc.js";

const SHOP_ID = "shop_vaidyanath_kalyan";
type Tab = "customers" | "doctors";
type Toast = { kind: "ok" | "err"; msg: string } | null;

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

export function DirectoryScreen() {
  const [tab, setTab] = useState<Tab>("customers");
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<readonly Customer[]>([]);
  const [doctors, setDoctors] = useState<readonly Doctor[]>([]);
  const [selectedCust, setSelectedCust] = useState<Customer | null>(null);
  const [rxList, setRxList] = useState<readonly Prescription[]>([]);
  const [toast, setToast] = useState<Toast>(null);

  // Customer form
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cGstin, setCGstin] = useState("");
  const [cGender, setCGender] = useState<"" | "M" | "F" | "O">("");
  const [cAbdm, setCAbdm] = useState(false);
  const [cMarketing, setCMarketing] = useState(false);
  const [cConsentMethod, setCConsentMethod] = useState<"" | "verbal" | "signed" | "otp" | "app">("");

  // Doctor form
  const [dReg, setDReg] = useState("");
  const [dName, setDName] = useState("");
  const [dPhone, setDPhone] = useState("");

  // Rx form
  const [rxKind, setRxKind] = useState<"paper" | "digital" | "abdm">("paper");
  const [rxDoctor, setRxDoctor] = useState("");
  const [rxDate, setRxDate] = useState(todayISO());
  const [rxNotes, setRxNotes] = useState("");

  useEffect(() => {
    if (!toast || toast.kind !== "ok") return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const loadCustomers = useCallback(async () => {
    setCustomers(await searchCustomersRpc(SHOP_ID, q, 25));
  }, [q]);
  const loadDoctors = useCallback(async () => {
    setDoctors(await searchDoctorsRpc(q, 25));
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => { tab === "customers" ? void loadCustomers() : void loadDoctors(); }, 120);
    return () => clearTimeout(t);
  }, [tab, q, loadCustomers, loadDoctors]);

  const openCustomer = useCallback(async (c: Customer) => {
    setSelectedCust(c);
    setCName(c.name); setCPhone(c.phone ?? ""); setCGstin(c.gstin ?? "");
    setCGender(c.gender ?? ""); setCAbdm(c.consentAbdm === 1); setCMarketing(c.consentMarketing === 1);
    setRxList(await listPrescriptionsRpc(c.id));
  }, []);

  const newCustomer = () => {
    setSelectedCust(null);
    setCName(""); setCPhone(""); setCGstin(""); setCGender("");
    setCAbdm(false); setCMarketing(false); setCConsentMethod(""); setRxList([]);
  };

  const saveCustomer = async () => {
    try {
      const id = await upsertCustomerRpc({
        ...(selectedCust ? { id: selectedCust.id } : {}),
        shopId: SHOP_ID,
        name: cName,
        phone: cPhone || null,
        gstin: cGstin || null,
        gender: (cGender || null) as "M" | "F" | "O" | null,
        consentAbdm: cAbdm,
        consentMarketing: cMarketing,
        consentMethod: (cConsentMethod || null) as "verbal" | "signed" | "otp" | "app" | null,
      });
      setToast({ kind: "ok", msg: `Saved customer · ${id.slice(0, 12)}` });
      await loadCustomers();
    } catch (e) {
      setToast({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const saveDoctor = async () => {
    try {
      const id = await upsertDoctorRpc({ regNo: dReg, name: dName, phone: dPhone || null });
      setToast({ kind: "ok", msg: `Saved doctor · ${id.slice(0, 12)}` });
      setDReg(""); setDName(""); setDPhone("");
      await loadDoctors();
    } catch (e) {
      setToast({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const addRx = async () => {
    if (!selectedCust) return;
    try {
      await createPrescriptionRpc({
        shopId: SHOP_ID, customerId: selectedCust.id,
        doctorId: rxDoctor || null, kind: rxKind,
        issuedDate: rxDate, notes: rxNotes || null,
      });
      setRxDoctor(""); setRxNotes("");
      setRxList(await listPrescriptionsRpc(selectedCust.id));
      setToast({ kind: "ok", msg: "Rx added" });
    } catch (e) {
      setToast({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["customers", "doctors"] as Tab[]).map((t) => (
          <button
            key={t}
            data-testid={`dir-tab-${t}`}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 14px", fontWeight: 500,
              background: tab === t ? "var(--pc-state-info)" : "var(--pc-bg-surface-2)",
              color: tab === t ? "var(--pc-bg-surface)" : "var(--pc-text-primary)",
              border: "none", borderRadius: 4, cursor: "pointer",
            }}
          >{t === "customers" ? "Customers" : "Doctors"}</button>
        ))}
      </div>

      <input
        data-testid="dir-search"
        placeholder={tab === "customers" ? "Search name / phone / GSTIN" : "Search name / reg no / phone"}
        value={q} onChange={(e) => setQ(e.target.value)}
        style={{ width: "100%", padding: "8px 12px", fontSize: 14, marginBottom: 12 }}
      />

      {tab === "customers" ? (
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <strong>{customers.length} customer{customers.length === 1 ? "" : "s"}</strong>
              <button data-testid="dir-new-customer" onClick={newCustomer}>+ New</button>
            </div>
            <div style={{ maxHeight: 480, overflowY: "auto", border: "1px solid #ddd", borderRadius: 4 }}>
              {customers.map((c) => (
                <div key={c.id}
                     data-testid={`dir-cust-${c.id}`}
                     onClick={() => void openCustomer(c)}
                     style={{
                       padding: "8px 10px", borderBottom: "1px solid #eee", cursor: "pointer",
                       background: selectedCust?.id === c.id ? "var(--pc-state-info-bg)" : "transparent",
                     }}>
                  <div style={{ fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--pc-text-secondary)" }}>
                    {c.phone ?? "—"} {c.consentAbdm === 1 && <span style={{ color: "var(--pc-state-success)" }}>· ABDM</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1.3 }}>
            <h3 style={{ marginTop: 0 }}>{selectedCust ? "Edit customer" : "New customer"}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
                Name *
                <input data-testid="cust-name" value={cName} onChange={(e) => setCName(e.target.value)} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
                Phone
                <input data-testid="cust-phone" value={cPhone} onChange={(e) => setCPhone(e.target.value)} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
                GSTIN
                <input data-testid="cust-gstin" value={cGstin} onChange={(e) => setCGstin(e.target.value.toUpperCase())} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
                Gender
                <select data-testid="cust-gender" value={cGender} onChange={(e) => setCGender(e.target.value as "" | "M" | "F" | "O")}>
                  <option value="">—</option><option value="M">M</option><option value="F">F</option><option value="O">O</option>
                </select>
              </label>
              <label style={{ fontSize: 12, gridColumn: "1 / span 2" }}>
                <input type="checkbox" data-testid="cust-consent-abdm" checked={cAbdm} onChange={(e) => setCAbdm(e.target.checked)} /> ABDM health ID linkage consent
              </label>
              <label style={{ fontSize: 12, gridColumn: "1 / span 2" }}>
                <input type="checkbox" data-testid="cust-consent-mkt" checked={cMarketing} onChange={(e) => setCMarketing(e.target.checked)} /> Marketing / refill-reminder consent
              </label>
              {(cAbdm || cMarketing) && (
                <label style={{ fontSize: 12, gridColumn: "1 / span 2", display: "flex", flexDirection: "column" }}>
                  Consent method (DPDP Act 2023)
                  <select data-testid="cust-consent-method" value={cConsentMethod} onChange={(e) => setCConsentMethod(e.target.value as "" | "verbal" | "signed" | "otp" | "app")}>
                    <option value="">—</option>
                    <option value="verbal">Verbal</option><option value="signed">Signed</option>
                    <option value="otp">OTP</option><option value="app">App</option>
                  </select>
                </label>
              )}
            </div>
            <button
              data-testid="cust-save"
              onClick={() => void saveCustomer()}
              disabled={!cName.trim()}
              style={{ padding: "8px 16px", fontWeight: 600 }}
            >Save customer</button>

            {selectedCust && (
              <div style={{ marginTop: 24, borderTop: "1px solid #ddd", paddingTop: 12 }}>
                <h3>Prescriptions ({rxList.length})</h3>
                <div style={{ display: "grid", gridTemplateColumns: "auto auto 1fr auto", gap: 8, marginBottom: 8, alignItems: "end" }}>
                  <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
                    Kind
                    <select data-testid="rx-kind" value={rxKind} onChange={(e) => setRxKind(e.target.value as "paper" | "digital" | "abdm")}>
                      <option value="paper">Paper</option><option value="digital">Digital</option><option value="abdm">ABDM</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
                    Issued
                    <input type="date" data-testid="rx-date" value={rxDate} onChange={(e) => setRxDate(e.target.value)} />
                  </label>
                  <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
                    Notes
                    <input data-testid="rx-notes" value={rxNotes} onChange={(e) => setRxNotes(e.target.value)} />
                  </label>
                  <button data-testid="rx-add" onClick={() => void addRx()}>+ Add Rx</button>
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {rxList.map((r) => (
                    <li key={r.id} data-testid={`rx-row-${r.id}`} style={{ padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 13 }}>
                      <span style={{ fontWeight: 500 }}>{r.issuedDate}</span> &middot; {r.kind} {r.notes && <>&middot; {r.notes}</>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <strong>{doctors.length} doctor{doctors.length === 1 ? "" : "s"}</strong>
            <div style={{ maxHeight: 480, overflowY: "auto", border: "1px solid #ddd", borderRadius: 4, marginTop: 6 }}>
              {doctors.map((d) => (
                <div key={d.id} data-testid={`dir-doc-${d.id}`} style={{ padding: "8px 10px", borderBottom: "1px solid #eee" }}>
                  <div style={{ fontWeight: 500 }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: "var(--pc-text-secondary)" }}>{d.regNo} {d.phone && <>&middot; {d.phone}</>}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginTop: 0 }}>Add doctor</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
                Registration no * <input data-testid="doc-reg" value={dReg} onChange={(e) => setDReg(e.target.value)} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
                Name * <input data-testid="doc-name" value={dName} onChange={(e) => setDName(e.target.value)} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column" }}>
                Phone <input data-testid="doc-phone" value={dPhone} onChange={(e) => setDPhone(e.target.value)} />
              </label>
              <button
                data-testid="doc-save"
                disabled={!dReg.trim() || !dName.trim()}
                onClick={() => void saveDoctor()}
                style={{ padding: "8px 16px", fontWeight: 600, alignSelf: "flex-start" }}
              >Save doctor</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div data-testid="dir-toast" data-toast-kind={toast.kind} style={{
          position: "fixed", bottom: 40, right: 24, padding: "10px 16px", borderRadius: 6,
          background: toast.kind === "ok" ? "var(--pc-state-success)" : "var(--pc-state-danger)", color: "var(--pc-bg-surface)", fontWeight: 500,
        }}>{toast.msg}</div>
      )}
    </div>
  );
}
