import { useEffect, useRef } from "react";
import { useReducedMotion } from "../utils/useReducedMotion.js";

/**
 * Ambient gradient mesh — slow-moving brand-tinted radial gradients on a
 * canvas backdrop. Sits behind the app, gives the interface a sense of place.
 *
 * Reduced-motion: renders one static frame, no animation loop.
 */

export interface AmbientMeshProps {
  /** Override blob count (default 3). */
  blobs?: number;
  /** Opacity multiplier 0..1 (default 0.5). */
  opacity?: number;
  className?: string;
}

interface Blob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: string;
}

const HUES = [
  "rgba(14, 81, 66, 0.58)",    // deep forest
  "rgba(255, 139, 92, 0.42)",  // warm coral
  "rgba(98, 86, 185, 0.28)",   // soft indigo
  "rgba(26, 135, 98, 0.36)",   // sage
];

export function AmbientMesh({ blobs = 3, opacity = 0.5, className }: AmbientMeshProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const items: Blob[] = Array.from({ length: blobs }, (_, i) => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      r: 200 + Math.random() * 300,
      hue: HUES[i % HUES.length] ?? HUES[0]!,
    }));

    let raf = 0;
    function tick() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const b of items) {
        if (!reduce) {
          b.x += b.vx;
          b.y += b.vy;
          if (b.x < -b.r) b.x = canvas.width + b.r;
          if (b.x > canvas.width + b.r) b.x = -b.r;
          if (b.y < -b.r) b.y = canvas.height + b.r;
          if (b.y > canvas.height + b.r) b.y = -b.r;
        }
        const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        grad.addColorStop(0, b.hue);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = opacity;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduce) raf = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [blobs, opacity, reduce]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={"pointer-events-none absolute inset-0 h-full w-full " + (className ?? "")}
    />
  );
}
