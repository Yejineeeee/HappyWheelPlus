import {
  AlertTriangle,
  Armchair,
  ArrowLeft,
  ArrowUpDown,
  Bath,
  Check,
  ChevronDown,
  ChevronUp,
  Droplet,
  Info,
  LocateFixed,
  MapPin,
  Moon,
  Navigation,
  Sun,
  X,
} from "lucide";

type IconNode = [string, Record<string, string | number>][];

const ICONS = {
  "alert-triangle": AlertTriangle,
  armchair: Armchair,
  "arrow-left": ArrowLeft,
  "arrow-up-down": ArrowUpDown,
  bath: Bath,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  droplet: Droplet,
  info: Info,
  "locate-fixed": LocateFixed,
  "map-pin": MapPin,
  moon: Moon,
  navigation: Navigation,
  sun: Sun,
  x: X,
} as unknown as Record<string, IconNode>;

export type IconName =
  | "alert-triangle"
  | "armchair"
  | "arrow-left"
  | "arrow-up-down"
  | "bath"
  | "check"
  | "chevron-down"
  | "chevron-up"
  | "droplet"
  | "info"
  | "locate-fixed"
  | "map-pin"
  | "moon"
  | "navigation"
  | "sun"
  | "x";

const NS = "http://www.w3.org/2000/svg";

export function icon(name: IconName, size = 20): SVGElement {
  const node = ICONS[name];
  if (!node) throw new Error(`unknown icon: ${name}`);
  const svg = document.createElementNS(NS, "svg");
  const set = (k: string, v: string) => svg.setAttribute(k, v);
  set("xmlns", NS);
  set("width", String(size));
  set("height", String(size));
  set("viewBox", "0 0 24 24");
  set("fill", "none");
  set("stroke", "currentColor");
  set("stroke-width", "2");
  set("stroke-linecap", "round");
  set("stroke-linejoin", "round");
  set("aria-hidden", "true");
  set("focusable", "false");
  for (const [tag, attrs] of node) {
    const child = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, String(v));
    svg.append(child);
  }
  return svg;
}
