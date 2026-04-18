import { useEffect, useRef, useState, useCallback } from "react";
import { searchProductsRpc, type ProductHit } from "../lib/ipc.js";

interface Props {
  readonly onPick: (hit: ProductHit) => void;
  readonly autoFocus?: boolean;
  readonly testId?: string;
  /**
   * When this value changes to a non-empty string, the internal query input
   * is set to it (and the debounced search fires). Used by GrnScreen's
   * "Search manually" action on low-confidence / unmatched import rows to
   * pre-fill the search with the parsed productHint. Clearing to "" does
   * not reset the input — it's one-way, opt-in.
   */
  readonly initialQuery?: string;
}

export function ProductSearch({ onPick, autoFocus, testId, initialQuery }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<readonly ProductHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  // Sync externally-supplied initialQuery into local `q`. Fires whenever the
  // parent bumps the prop, even to the same string (via a different identity)
  // — but we gate on a non-empty value.
  useEffect(() => {
    if (initialQuery && initialQuery.length > 0) {
      setQ(initialQuery);
    }
  }, [initialQuery]);

  // Debounced search.
  useEffect(() => {
    const s = q.trim();
    if (!s) { setHits([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      const r = await searchProductsRpc(s, 8);
      setHits(r);
      setCursor(0);
      setOpen(r.length > 0);
    }, 80);
    return () => clearTimeout(t);
  }, [q]);

  const pick = useCallback((h: ProductHit) => {
    onPick(h);
    setQ(""); setHits([]); setOpen(false); setCursor(0);
    inputRef.current?.focus();
  }, [onPick]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const h = hits[cursor]; if (h) pick(h); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search product... (\u2191\u2193\u21b5 to pick)"
        data-testid={testId ?? "product-search"}
      />
      {open && (
        <ul
          data-testid="search-dropdown"
          style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
            listStyle: "none", margin: 0, padding: 0,
            background: "#1e293b", border: "1px solid #334155", borderRadius: 4, maxHeight: 280, overflow: "auto",
          }}
        >
          {hits.map((h, i) => (
            <li
              key={h.id}
              data-testid={`search-hit-${i}`}
              onMouseDown={(e) => { e.preventDefault(); pick(h); }}
              style={{
                padding: "8px 10px", cursor: "pointer",
                background: i === cursor ? "#334155" : "transparent",
                borderBottom: "1px solid #1e293b",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{h.name}</strong>
                <span style={{ color: "#94a3b8", fontSize: 12 }}>
                  {h.schedule !== "OTC" && <span style={{ background: "#dc2626", color: "white", padding: "1px 5px", borderRadius: 3, marginRight: 6 }}>{h.schedule}</span>}
                  \u20b9{(h.mrpPaise / 100).toFixed(2)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                {h.genericName ?? "\u2014"} \u00b7 {h.manufacturer} \u00b7 GST {h.gstRate}%
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
