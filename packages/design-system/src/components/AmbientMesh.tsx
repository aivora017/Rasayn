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
  "rgba(10, 67, 56, 0.62)",    // deeper forest
  "rgba(255, 122, 74, 0.44)",  // saturated terracotta
  "rgba(107, 91, 209, 0.30)",  // ai-violet
  "rgba(31, 138, 105, 0.38)",  // sage
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

    // Parallax: each blob has an independent factor 0.10..0.45 so they shift
    // at different rates as the surrounding scroll container moves.
    const parallaxFactors = items.map((_, i) => 0.10 + (i * 0.13) % 0.35);
    let scrollY = 0;
    function findScrollParent(node: Element | null): Element | Window {
      let n: Element | null = node;
      while (n && n !== document.body) {
        const o = getComputedStyle(n).overflowY;
        if (o === "auto" || o === "scroll") return n;
        n = n.parentElement;
      }
      return window;
    }
    const scrollHost = findScrollParent(canvas);
    const onScroll = () => {
      scrollY = scrollHost === window
        ? window.scrollY
        : (scrollHost as Element).scrollTop;
    };
    scrollHost.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    let raf = 0;
    function tick() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < items.length; i++) {
        const b = items[i]!;
        if (!reduce) {
          b.x += b.vx;
          b.y += b.vy;
          if (b.x < -b.r) b.x = canvas.width + b.r;
          if (b.x > canvas.width + b.r) b.x = -b.r;
          if (b.y < -b.r) b.y = canvas.height + b.r;
          if (b.y > canvas.height + b.r) b.y = -b.r;
        }
        const parallaxY = b.y - scrollY * (parallaxFactors[i] ?? 0.2) * dpr;
        const grad = ctx.createRadialGradient(b.x, parallaxY, 0, b.x, parallaxY, b.r);
        grad.addColorStop(0, b.hue);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = opacity;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, parallaxY, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduce) raf = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scrollHost.removeEventListener("scroll", onScroll);
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
