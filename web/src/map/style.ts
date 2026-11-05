import type { ExpressionSpecification } from "maplibre-gl";

/** 점수 색(0→100, 나쁨→좋음). 두 테마 공통. */
export const SCORE_STOPS: [number, string][] = [
  [0, "#440154"],
  [30, "#414487"],
  [55, "#2a788e"],
  [80, "#22a884"],
  [100, "#7ad151"],
];

export function scoreColorExpression(): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["get", "s"],
    ...SCORE_STOPS.flatMap(([v, c]) => [v, c]),
  ] as ExpressionSpecification;
}

export function mapStyleUrl(theme: "light" | "dark"): string {
  return theme === "dark"
    ? "https://tiles.openfreemap.org/styles/dark"
    : "https://tiles.openfreemap.org/styles/positron";
}

/** 점수를 SCORE_STOPS 사이에서 보간한 hex 색(HTML 마커용). */
export function scoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  for (let i = 1; i < SCORE_STOPS.length; i++) {
    const [v1, c1] = SCORE_STOPS[i];
    if (s <= v1) {
      const [v0, c0] = SCORE_STOPS[i - 1];
      const t = (s - v0) / (v1 - v0);
      const a = parseHex(c0);
      const b = parseHex(c1);
      const m = a.map((x, k) => Math.round(x + (b[k] - x) * t));
      return `#${m.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return SCORE_STOPS[SCORE_STOPS.length - 1][1];
}

function parseHex(h: string): number[] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}
