// Ambient module for lucide-react@0.473 — that release shipped without
// a top-level .d.ts entry. Each icon component takes the standard SVG
// props plus `size` and accepts color via `currentColor`.
declare module "lucide-react" {
  import type { SVGProps, ComponentType } from "react";
  export interface LucideProps extends SVGProps<SVGSVGElement> {
    size?: number | string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
    color?: string;
  }
  export type LucideIcon = ComponentType<LucideProps>;
  export const Search: LucideIcon;
  export const Receipt: LucideIcon;
  export const Package: LucideIcon;
  export const ChartLine: LucideIcon;
  export const PackagePlus: LucideIcon;
  export const Undo2: LucideIcon;
  export const UsersRound: LucideIcon;
  export const FileText: LucideIcon;
  export const Mail: LucideIcon;
  export const Settings2: LucideIcon;
  export const ShieldCheck: LucideIcon;
  export const Plug: LucideIcon;
  export const Calendar: LucideIcon;
  export const ZoomIn: LucideIcon;
  export const ZoomOut: LucideIcon;
  export const Crown: LucideIcon;
  export const Percent: LucideIcon;
  export const Languages: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const AlertCircle: LucideIcon;
  export const Wallet: LucideIcon;
  export const IndianRupee: LucideIcon;
  export const TrendingDown: LucideIcon;
  export const TrendingUp: LucideIcon;
  export const ShieldX: LucideIcon;
  export const Copy: LucideIcon;
  export const ZoomIn: LucideIcon;
  export const ZoomOut: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const Sparkles: LucideIcon;
  export const Pill: LucideIcon;
  export const LayoutDashboard: LucideIcon;
  export const Command: LucideIcon;
  export const Camera: LucideIcon;
  export const TriangleAlert: LucideIcon;
  export const ChevronDown: LucideIcon;
  export const Printer: LucideIcon;
  export const Download: LucideIcon;
  export const Upload: LucideIcon;
  export const Stethoscope: LucideIcon;
  export const Truck: LucideIcon;
  export const Image: LucideIcon;
  export const Hourglass: LucideIcon;
  export const Landmark: LucideIcon;
  export const FlaskConical: LucideIcon;
  export const ChevronLeft: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const Plus: LucideIcon;
  export const Minus: LucideIcon;
  export const X: LucideIcon;
  export const Check: LucideIcon;
  export const Filter: LucideIcon;
  export const SlidersHorizontal: LucideIcon;
  export const Eye: LucideIcon;
  export const EyeOff: LucideIcon;
  export const ArrowUp: LucideIcon;
  export const ArrowDown: LucideIcon;
}
