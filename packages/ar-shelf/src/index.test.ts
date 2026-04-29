import { describe, it, expect } from "vitest";
import {
  bboxIou,
  bboxDistance,
  cosineSimilarity,
  nonMaxSuppress,
  matchSku,
  updateTracking,
  INITIAL_TRACKING,
  isOccluded,
  buildAnnotations,
  type RawDetection,
  type SkuLibraryEntry,
  type Bbox,
} from "./index.js";

describe("bbox math", () => {
  it("IoU = 1 for identical boxes", () => {
    expect(bboxIou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
  });
  it("IoU = 0 for disjoint boxes", () => {
    expect(bboxIou([0, 0, 10, 10], [20, 20, 10, 10])).toBe(0);
  });
  it("IoU computed correctly for partial overlap", () => {
    // 10x10 boxes, overlap is 5x5
    const iou = bboxIou([0, 0, 10, 10], [5, 5, 10, 10]);
    expect(iou).toBeCloseTo(25 / (100 + 100 - 25), 5);
  });
  it("distance between centers", () => {
    expect(bboxDistance([0, 0, 10, 10], [10, 0, 10, 10])).toBe(10);
  });
});

describe("cosineSimilarity", () => {
  it("1.0 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });
  it("0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it("-1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });
  it("0 for empty / mismatched length", () => {
    expect(cosineSimilarity([], [1])).toBe(0);
  });
});

describe("nonMaxSuppress", () => {
  it("keeps highest-confidence detection in a cluster", () => {
    const dets: RawDetection[] = [
      { bbox: [0, 0, 10, 10], confidence: 0.6, embedding: [1] },
      { bbox: [1, 1, 10, 10], confidence: 0.9, embedding: [1] }, // overlapping, higher conf
      { bbox: [50, 50, 10, 10], confidence: 0.7, embedding: [1] }, // separate
    ];
    const out = nonMaxSuppress(dets, 0.4);
    expect(out.length).toBe(2);
    expect(out[0]?.confidence).toBe(0.9);
  });
  it("keeps all when no overlap", () => {
    const dets: RawDetection[] = [
      { bbox: [0, 0, 10, 10], confidence: 0.6, embedding: [1] },
      { bbox: [50, 50, 10, 10], confidence: 0.7, embedding: [1] },
    ];
    expect(nonMaxSuppress(dets, 0.4).length).toBe(2);
  });
});

describe("matchSku", () => {
  const lib: SkuLibraryEntry[] = [
    {
      productId: "p1", productName: "Crocin", mrpPaise: 2800, stockOnHand: 12,
      nearestExpiry: "2027-04", tamperShieldScore: 0.95,
      embedding: [1, 0, 0],
    },
    {
      productId: "p2", productName: "Dolo 650", mrpPaise: 3500, stockOnHand: 5,
      nearestExpiry: "2026-11", tamperShieldScore: 0.92,
      embedding: [0, 1, 0],
    },
  ];

  it("matches the closest embedding above threshold", () => {
    const det: RawDetection = { bbox: [0, 0, 1, 1], confidence: 0.9, embedding: [0.95, 0.05, 0] };
    const m = matchSku(det, lib, 0.85);
    expect(m.entry?.productId).toBe("p1");
  });

  it("returns null when below threshold", () => {
    const det: RawDetection = { bbox: [0, 0, 1, 1], confidence: 0.9, embedding: [0.5, 0.5, 0] };
    const m = matchSku(det, lib, 0.95);
    expect(m.entry).toBeNull();
  });
});

describe("updateTracking", () => {
  it("assigns new IDs on first frame", () => {
    const out = updateTracking(INITIAL_TRACKING, [
      { bbox: [0, 0, 10, 10], productId: "p1" },
      { bbox: [50, 0, 10, 10], productId: "p2" },
    ]);
    expect(out.tracks.length).toBe(2);
    expect(new Set(out.tracks.map((t) => t.id)).size).toBe(2);
  });

  it("preserves IDs across frames when bboxes overlap", () => {
    const f1 = updateTracking(INITIAL_TRACKING, [
      { bbox: [0, 0, 10, 10], productId: "p1" },
    ]);
    const id1 = f1.tracks[0]!.id;
    const f2 = updateTracking(f1, [
      { bbox: [1, 1, 10, 10], productId: "p1" },  // slightly moved
    ]);
    expect(f2.tracks[0]!.id).toBe(id1);
  });

  it("assigns new ID when productId differs", () => {
    const f1 = updateTracking(INITIAL_TRACKING, [
      { bbox: [0, 0, 10, 10], productId: "p1" },
    ]);
    const id1 = f1.tracks[0]!.id;
    const f2 = updateTracking(f1, [
      { bbox: [1, 1, 10, 10], productId: "p2" },  // different product
    ]);
    expect(f2.tracks.find((t) => t.productId === "p2")?.id).not.toBe(id1);
  });
});

describe("isOccluded", () => {
  it("not occluded when observed area = expected", () => {
    expect(isOccluded([0, 0, 10, 10], [0, 0, 10, 10])).toBe(false);
  });
  it("occluded when observed < 80% of expected", () => {
    expect(isOccluded([0, 0, 5, 5], [0, 0, 10, 10])).toBe(true);  // 25%
  });
  it("not occluded at boundary", () => {
    expect(isOccluded([0, 0, 9, 9], [0, 0, 10, 10])).toBe(false);  // 81%
  });
});

describe("buildAnnotations", () => {
  const lib: SkuLibraryEntry[] = [
    {
      productId: "p1", productName: "Crocin", mrpPaise: 2800, stockOnHand: 12,
      nearestExpiry: "2027-04", tamperShieldScore: 0.95,
      embedding: [1, 0, 0],
    },
  ];

  it("end-to-end: detect → NMS → match → annotate", () => {
    const dets: RawDetection[] = [
      { bbox: [0, 0, 10, 10], confidence: 0.95, embedding: [0.99, 0.01, 0] },
      { bbox: [1, 1, 10, 10], confidence: 0.6, embedding: [0.99, 0.01, 0] }, // suppressed by NMS
    ];
    const out = buildAnnotations(dets, lib);
    expect(out.annotations.length).toBe(1);
    expect(out.annotations[0]?.productId).toBe("p1");
    expect(out.annotations[0]?.matchConfidence).toBeGreaterThan(0.9);
    expect(out.tracking.tracks.length).toBe(1);
  });

  it("filters below minConfidence", () => {
    const dets: RawDetection[] = [
      { bbox: [0, 0, 10, 10], confidence: 0.3, embedding: [1, 0, 0] },
    ];
    expect(buildAnnotations(dets, lib).annotations.length).toBe(0);
  });

  it("flags occlusion when expected size provided", () => {
    const dets: RawDetection[] = [
      { bbox: [0, 0, 5, 5], confidence: 0.95, embedding: [1, 0, 0] },
    ];
    const out = buildAnnotations(dets, lib, {
      expectedSizes: new Map([["p1", [0, 0, 10, 10] as Bbox]]),
    });
    expect(out.annotations[0]?.occluded).toBe(true);
  });
});
