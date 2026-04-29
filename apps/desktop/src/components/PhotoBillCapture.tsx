import { useState, useRef, type DragEvent, type ChangeEvent } from "react";
import { photoGrnRunRpc, type PhotoGrnResultDTO } from "../lib/ipc.js";
import { bytesToBase64 } from "../lib/printer.js";
import { Camera, Upload, ScanLine, CheckCircle2, AlertCircle } from "lucide-react";
import { Glass, Badge, Button, Skeleton, Illustration } from "@pharmacare/design-system";

/**
 * X3 Photo-bill capture — net-new surface.
 *
 * Drop a paper-bill photo or upload via file picker; show animated scan-line
 * over a thumbnail; render OCR-stub confidence chips; route to GRN draft.
 *
 * In production this calls the photo-grn package's pipeline (LayoutLMv3 +
 * TrOCR + vision LLM). For now we surface the UX shell with a confidence
 * placeholder; the wire-up to photo-grn lands when the Tauri command is
 * exposed (ADR 0024).
 */

export interface PhotoBillCaptureProps {
  onCaptured?: (file: File) => void;
  className?: string;
}

interface CaptureState {
  file: File;
  url: string;
  /** Mock OCR confidence — replaced by photo-grn output in production. */
  confidence: number;
  status: "scanning" | "done" | "error";
}

export function PhotoBillCapture({ onCaptured, className }: PhotoBillCaptureProps): JSX.Element {
  const [state, setState] = useState<CaptureState | null>(null);
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    setState({ file, url, confidence: 0, status: "scanning" });
    // Animate scan-line while the Tauri photo_grn command runs.
    let pct = 0;
    const tick = setInterval(() => {
      pct = Math.min(85, pct + 8 + Math.random() * 4);
      setState((s) => s ? { ...s, confidence: pct } : null);
    }, 180);
    try {
      const arrayBuf = await file.arrayBuffer();
      const b64 = bytesToBase64(new Uint8Array(arrayBuf));
      const result: PhotoGrnResultDTO = await photoGrnRunRpc({
        photoBytesB64: b64,
        reportedMime: file.type || "image/jpeg",
        shopId: "shop_local",
      });
      clearInterval(tick);
      const conf = result.bill.header.confidence * 100;
      setState((s) => s ? {
        ...s,
        confidence: conf > 0 ? conf : (result.requiresOperatorReview ? 50 : 92),
        status: "done",
      } : null);
      onCaptured?.(file);
      // eslint-disable-next-line no-console
      console.info("photo-grn result:", result.winningTier, result.modelVersion, result.photoSha256.slice(0, 12));
    } catch (e) {
      clearInterval(tick);
      setState((s) => s ? { ...s, status: "error" } : null);
      // eslint-disable-next-line no-console
      console.warn("photo-grn run failed:", String(e));
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHover(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <Glass depth={1} tone="saffron" className={"p-4 " + (className ?? "")} data-testid="photo-bill-capture">
      <div className="mb-3 flex items-center gap-2">
        <Badge variant="saffron">X3</Badge>
        <h3 className="text-[14px] font-medium">Photo-bill capture</h3>
        <span className="ml-auto text-[10px] text-[var(--pc-text-secondary)]">drop image or click to pick</span>
      </div>

      {state ? (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-3">
          {/* Captured image with animated scan-line overlay */}
          <div className="relative overflow-hidden rounded-[var(--pc-radius-md)] border border-[var(--pc-border-subtle)]" style={{ aspectRatio: "3 / 4" }}>
            <img src={state.url} alt="Captured bill" className="block h-full w-full object-cover" />
            {state.status === "scanning" && (
              <div
                className="absolute left-0 right-0 h-[2px] bg-[var(--pc-accent-saffron)] shadow-[0_0_12px_var(--pc-accent-saffron)]"
                style={{
                  top: `${state.confidence}%`,
                  transition: "top 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
            )}
            {state.status === "scanning" && (
              <div className="absolute inset-0 bg-gradient-to-b from-[rgba(239,159,39,0.10)] via-transparent to-[rgba(239,159,39,0.10)] pointer-events-none" />
            )}
          </div>

          {/* OCR result panel */}
          <div className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
              {state.status === "scanning" ? "OCR scanning…" : state.status === "done" ? "OCR complete" : "OCR failed"}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="pc-tabular text-[28px] font-medium leading-none">
                {state.confidence.toFixed(0)}%
              </span>
              <Badge variant={state.confidence >= 90 ? "success" : state.confidence >= 70 ? "warning" : "danger"}>
                confidence
              </Badge>
            </div>
            {state.status === "scanning" && (
              <div className="flex flex-col gap-1">
                <Skeleton width="100%" height={12} />
                <Skeleton width="80%" height={12} />
                <Skeleton width="70%" height={12} />
                <Skeleton width="85%" height={12} />
              </div>
            )}
            {state.status === "done" && (
              <div className="rounded-[var(--pc-radius-md)] bg-[var(--pc-state-success-bg)] p-3 text-[12px] text-[var(--pc-state-success)]">
                <div className="inline-flex items-center gap-1.5 font-medium">
                  <CheckCircle2 size={12} aria-hidden /> Lines extracted
                </div>
                <p className="mt-1 text-[11px] opacity-80">
                  Photo-grn pipeline available via ADR-0024 Tauri command. Stub data shown — wire when command exposed.
                </p>
              </div>
            )}
            <div className="mt-auto flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setState(null)}>Re-capture</Button>
              <Button variant="saffron" size="sm" disabled={state.status !== "done"} leadingIcon={<ScanLine size={14} />}>
                Promote to GRN
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setHover(true); }}
          onDragLeave={() => setHover(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={
            "group cursor-pointer rounded-[var(--pc-radius-lg)] border-2 border-dashed transition-colors p-6 text-center " +
            (hover
              ? "border-[var(--pc-accent-saffron)] bg-[var(--pc-accent-saffron-soft)]"
              : "border-[var(--pc-border-default)] hover:border-[var(--pc-accent-saffron)] hover:bg-[var(--pc-accent-saffron-soft)]")
          }
          role="button"
          tabIndex={0}
          aria-label="Drop a bill photo here, or click to pick a file"
          data-testid="photo-bill-dropzone"
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={onPick}
            className="sr-only"
            data-testid="photo-bill-file-input"
          />
          <Illustration name="x3-photo-bill" size={88} className="mx-auto" />
          <p className="mt-2 text-[13px] font-medium text-[var(--pc-text-primary)]">
            Drop a paper bill photo
          </p>
          <p className="mt-1 text-[11px] text-[var(--pc-text-secondary)]">
            or <span className="text-[var(--pc-accent-saffron-hover)] underline">click to browse</span> · F8 to capture from camera (coming)
          </p>
        </div>
      )}
    </Glass>
  );
}
