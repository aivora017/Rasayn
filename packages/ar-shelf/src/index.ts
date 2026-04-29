// @pharmacare/ar-shelf
// Pure annotation logic for shelf AR overlay. Handles bbox math (IoU,
// non-max suppression, frame-to-frame tracking ID stability), match-
// confidence scoring against the SKU library, and occlusion handling.
//
// The vision pipeline (MobileNetV3 / WebGPU / X2 image hash) is injected as
// a transport — this package is dependency-free and fully testable.

// ────────────────────────────────────────────────────────────────────────
// Geometry
// ────────────────────────────────────────────────────────────────────────

export type Bbox = readonly [number, number, number, number]; // [x, y, w, h]

export function bboxIou(a: Bbox, b: Bbox): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const aRight = ax + aw, aBot = ay + ah;
  const bRight = bx + bw, bBot = by + bh;
  const interW = Math.max(0, Math.min(aRight, bRight) - Math.max(ax, bx));
  const interH = Math.max(0, Math.min(aBot, bBot) - Math.max(ay, by));
  const inter = interW * interH;
  const union = aw * ah + bw * bh - inter;
  return union <= 0 ? 0 : inter / union;
}

export function bboxCenter(b: Bbox): readonly [number, number] {
  return [b[0] + b[2] / 2, b[1] + b[3] / 2];
}

export function bboxDistance(a: Bbox, b: Bbox): number {
  const [ax, ay] = bboxCenter(a);
  const [bx, by] = bboxCenter(b);
  return Math.hypot(ax - bx, ay - by);
}

// ────────────────────────────────────────────────────────────────────────
// Detections + annotations
// ────────────────────────────────────────────────────────────────────────

export interface RawDetection {
  readonly bbox: Bbox;
  readonly confidence: number;       // 0..1 from vision model
  readonly embedding: readonly number[];  // perceptual hash / phash for SKU match
}

export interface SkuLibraryEntry {
  readonly productId: string;
  readonly productName: string;
  readonly mrpPaise: number;
  readonly stockOnHand: number;
  readonly nearestExpiry: string;
  readonly tamperShieldScore: number;
  readonly embedding: readonly number[];
}

export interface ShelfAnnotation {
  readonly bbox: Bbox;
  readonly trackingId: string;
  readonly productId: string;
  readonly productName: string;
  readonly mrpPaise: number;
  readonly stockOnHand: number;
  readonly nearestExpiry: string;
  readonly tamperShieldScore: number;
  readonly matchConfidence: number;  // 0..1 — combined visual + SKU match
  readonly occluded: boolean;        // true if bbox area < 80% of expected
}

// ────────────────────────────────────────────────────────────────────────
// Non-Maximum Suppression — keep best detection per spatial cluster
// ────────────────────────────────────────────────────────────────────────

export function nonMaxSuppress(
  detections: readonly RawDetection[],
  iouThreshold = 0.4,
): readonly RawDetection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: RawDetection[] = [];
  for (const d of sorted) {
    let suppressed = false;
    for (const k of kept) {
      if (bboxIou(d.bbox, k.bbox) > iouThreshold) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) kept.push(d);
  }
  return kept;
}

// ────────────────────────────────────────────────────────────────────────
// SKU embedding match (cosine similarity)
// ────────────────────────────────────────────────────────────────────────

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface SkuMatch {
  readonly entry: SkuLibraryEntry | null;
  readonly score: number;
}

export function matchSku(
  detection: RawDetection,
  library: readonly SkuLibraryEntry[],
  minScore = 0.85,
): SkuMatch {
  let best: SkuMatch = { entry: null, score: 0 };
  for (const e of library) {
    const s = cosineSimilarity(detection.embedding, e.embedding);
    if (s > best.score) best = { entry: e, score: s };
  }
  return best.score >= minScore ? best : { entry: null, score: best.score };
}

// ────────────────────────────────────────────────────────────────────────
// Frame-to-frame tracking — keep stable IDs across frames
// ────────────────────────────────────────────────────────────────────────

export interface Track {
  readonly id: string;
  readonly bbox: Bbox;
  readonly productId: string;
  readonly lastSeenFrame: number;
}

export interface TrackingState {
  readonly tracks: readonly Track[];
  readonly nextId: number;
  readonly currentFrame: number;
}

export const INITIAL_TRACKING: TrackingState = {
  tracks: [],
  nextId: 1,
  currentFrame: 0,
};

const TRACK_IOU_THRESHOLD = 0.3;
const TRACK_TTL_FRAMES = 5;

export function updateTracking(
  prev: TrackingState,
  detections: readonly { bbox: Bbox; productId: string }[],
): TrackingState {
  const nextFrame = prev.currentFrame + 1;
  const prevTracks = prev.tracks.filter(
    (t) => nextFrame - t.lastSeenFrame <= TRACK_TTL_FRAMES,
  );
  const used = new Set<string>();
  const out: Track[] = [];
  let nextId = prev.nextId;
  for (const d of detections) {
    let bestTrack: Track | null = null;
    let bestIou = TRACK_IOU_THRESHOLD;
    for (const t of prevTracks) {
      if (used.has(t.id)) continue;
      if (t.productId !== d.productId) continue;
      const iou = bboxIou(t.bbox, d.bbox);
      if (iou > bestIou) {
        bestIou = iou;
        bestTrack = t;
      }
    }
    if (bestTrack) {
      used.add(bestTrack.id);
      out.push({
        id: bestTrack.id,
        bbox: d.bbox,
        productId: d.productId,
        lastSeenFrame: nextFrame,
      });
    } else {
      const id = `track_${nextId++}`;
      out.push({ id, bbox: d.bbox, productId: d.productId, lastSeenFrame: nextFrame });
    }
  }
  // Carry over still-fresh tracks not observed this frame.
  for (const t of prevTracks) {
    if (!used.has(t.id) && !out.some((x) => x.id === t.id)) {
      out.push(t);
    }
  }
  return { tracks: out, nextId, currentFrame: nextFrame };
}

// ────────────────────────────────────────────────────────────────────────
// Occlusion — detect via area-vs-expected ratio
// ────────────────────────────────────────────────────────────────────────

export function isOccluded(observed: Bbox, expected: Bbox, threshold = 0.8): boolean {
  const observedArea = observed[2] * observed[3];
  const expectedArea = expected[2] * expected[3];
  if (expectedArea <= 0) return false;
  return observedArea / expectedArea < threshold;
}

// ────────────────────────────────────────────────────────────────────────
// Top-level: build annotations from raw frame detections
// ────────────────────────────────────────────────────────────────────────

export interface AnnotateOptions {
  readonly nmsIou?: number;
  readonly skuMatchThreshold?: number;
  readonly minConfidence?: number;
  readonly trackingState?: TrackingState;
  readonly expectedSizes?: ReadonlyMap<string, Bbox>;  // for occlusion check
}

export interface AnnotateResult {
  readonly annotations: readonly ShelfAnnotation[];
  readonly tracking: TrackingState;
}

export function buildAnnotations(
  detections: readonly RawDetection[],
  library: readonly SkuLibraryEntry[],
  opts: AnnotateOptions = {},
): AnnotateResult {
  const nms = nonMaxSuppress(detections, opts.nmsIou ?? 0.4);
  const minConf = opts.minConfidence ?? 0.5;
  const filtered = nms.filter((d) => d.confidence >= minConf);

  // Match each detection to a SKU.
  const matches: { det: RawDetection; entry: SkuLibraryEntry; score: number }[] = [];
  for (const d of filtered) {
    const m = matchSku(d, library, opts.skuMatchThreshold ?? 0.85);
    if (m.entry) matches.push({ det: d, entry: m.entry, score: m.score });
  }

  // Update tracking with the (bbox, productId) tuples.
  const trackingIn = opts.trackingState ?? INITIAL_TRACKING;
  const tracking = updateTracking(
    trackingIn,
    matches.map((m) => ({ bbox: m.det.bbox, productId: m.entry.productId })),
  );

  const annotations: ShelfAnnotation[] = matches.map((m) => {
    const trk = tracking.tracks.find(
      (t) => t.productId === m.entry.productId && bboxIou(t.bbox, m.det.bbox) > TRACK_IOU_THRESHOLD,
    );
    const expected = opts.expectedSizes?.get(m.entry.productId);
    const occluded = expected ? isOccluded(m.det.bbox, expected) : false;
    return {
      bbox: m.det.bbox,
      trackingId: trk?.id ?? `track_unassigned`,
      productId: m.entry.productId,
      productName: m.entry.productName,
      mrpPaise: m.entry.mrpPaise,
      stockOnHand: m.entry.stockOnHand,
      nearestExpiry: m.entry.nearestExpiry,
      tamperShieldScore: m.entry.tamperShieldScore,
      matchConfidence: combinedConfidence(m.det.confidence, m.score),
      occluded,
    };
  });

  return { annotations, tracking };
}

function combinedConfidence(visualConf: number, embeddingScore: number): number {
  // Geometric mean — penalises low values on either axis.
  return Math.sqrt(Math.max(0, visualConf) * Math.max(0, embeddingScore));
}

// ────────────────────────────────────────────────────────────────────────
// I/O port — caller injects the actual frame-detection transport
// ────────────────────────────────────────────────────────────────────────

export interface FrameTransport {
  detect(frame: ImageBitmap): Promise<readonly RawDetection[]>;
}

let transport: FrameTransport | null = null;

export function setFrameTransport(t: FrameTransport): void {
  transport = t;
}

export async function annotateFrame(
  frame: ImageBitmap,
  library: readonly SkuLibraryEntry[],
  opts: AnnotateOptions = {},
): Promise<AnnotateResult> {
  if (!transport) throw new Error("FRAME_TRANSPORT_NOT_SET");
  const detections = await transport.detect(frame);
  return buildAnnotations(detections, library, opts);
}
