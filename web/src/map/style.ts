import type { ExpressionSpecification } from "maplibre-gl";

/** 점수 색(0→100, 나쁨→좋음). 두 테마 공통. */
export const SCORE_STOPS: [number, string][] = [
  [0, "#440154"],
  [30, "#414487"],
  [55, "#2a788e"],
  [80, "#22a884"],
  [100, "#7ad151"],
];

/** s < 0(점수 없음)이면 neutral 색, 아니면 점수 보간. */
export function scoreColorExpression(neutral = "#6b7280"): ExpressionSpecification {
  return [
    "case",
    ["<", ["get", "s"], 0],
    neutral,
    [
      "interpolate",
      ["linear"],
      ["get", "s"],
      ...SCORE_STOPS.flatMap(([v, c]) => [v, c]),
    ],
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

export const POI_ICON_CSS_PX = 32;
export const POI_PIXEL_RATIO = 2;

/** 편의시설 아이콘 캔버스 한 변(px) = CSS 크기 × pixelRatio. */
export function poiCanvasSize(): number {
  return POI_ICON_CSS_PX * POI_PIXEL_RATIO;
}

export interface StyleLayerInfo {
  id: string;
  type: string;
  "source-layer"?: string;
}

/**
 * 구간 히트맵을 끼워 넣을 기준 레이어 id(이 레이어 바로 앞에 넣는다). undefined면 맨 위.
 * 기본 지도의 마지막 도로 선(OpenMapTiles transportation 선 레이어) 바로 뒤에 두어, 도로 위·도로명 글자 아래가 되게 한다.
 * 도로 선 사이에 섞여 있는 일방통행 화살표 글자는 히트맵 아래로 갈 수 있다(감수한 절충).
 * 도로 선 레이어가 없으면 첫 글자 레이어 앞, 그것도 없으면 undefined.
 * `layers`에는 앱이 추가한 레이어를 넣지 않는다.
 */
export function segmentAnchor(layers: StyleLayerInfo[]): string | undefined {
  let last = -1;
  layers.forEach((l, i) => {
    if (l.type === "line" && l["source-layer"] === "transportation") last = i;
  });
  if (last >= 0) return layers[last + 1]?.id;
  return layers.find((l) => l.type === "symbol")?.id;
}
