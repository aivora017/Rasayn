import { useEffect, useState } from "react";
import { getProductImageRpc, type ProductImageRowDTO } from "../lib/ipc.js";

export interface ProductImageThumbProps {
  readonly productId: string;
  readonly size?: number;
  readonly rounded?: boolean;
  readonly alt?: string;
  readonly onMissing?: () => void;
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly row: ProductImageRowDTO }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string };

export function ProductImageThumb(props: ProductImageThumbProps) {
  const { productId, size = 48, rounded = true, alt = "Product image", onMissing } = props;
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const row = await getProductImageRpc(productId);
        if (cancelled) return;
        if (row === null) {
          setState({ kind: "missing" });
          if (onMissing) onMissing();
        } else {
          setState({ kind: "loaded", row });
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
      }
    })();
    return () => { cancelled = true; };
  }, [productId, onMissing]);

  const box: React.CSSProperties = {
    width: size, height: size,
    borderRadius: rounded ? 4 : 0,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "#f2f2f2", color: "#666",
    fontSize: Math.max(9, Math.floor(size / 5)),
    overflow: "hidden", boxSizing: "border-box",
  };

  if (state.kind === "loading") return <div data-testid="pit-loading" style={box}>…</div>;
  if (state.kind === "missing") return <div data-testid="pit-missing" style={box}>no image</div>;
  if (state.kind === "error") return <div data-testid="pit-error" style={box} title={state.message}>!</div>;
  const src = `data:${state.row.mime};base64,${state.row.bytesB64}`;
  return (
    <img
      data-testid="pit-image"
      src={src}
      alt={alt}
      style={{ ...box, objectFit: "cover", background: "transparent" }}
    />
  );
}
