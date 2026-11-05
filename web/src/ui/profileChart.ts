import * as Plot from "@observablehq/plot";
import { el } from "./components";

export type ProfileRow = [number, number | null, number | null];

const STEEP_PCT = 6;

export function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 경사 6% 이상이 이어지는 구간을 [시작 거리, 끝 거리]로 묶는다. */
export function steepBands(rows: ProfileRow[]): [number, number][] {
  const bands: [number, number][] = [];
  let start: number | null = null;
  let last = 0;
  for (let i = 0; i < rows.length; i++) {
    const g = rows[i][2];
    const steep = g !== null && g >= STEEP_PCT;
    if (steep) {
      if (start === null) start = i > 0 ? rows[i - 1][0] : rows[i][0];
      last = rows[i][0];
    } else if (start !== null) {
      bands.push([start, last]);
      start = null;
    }
  }
  if (start !== null) bands.push([start, last]);
  return bands;
}

/** 가로축 눈금: 1km 이상이면 km, 아니면 m. */
function distTick(d: number): string {
  return d >= 1000 ? `${+(d / 1000).toFixed(1)}km` : `${d}m`;
}

function hasElevation(rows: ProfileRow[]): boolean {
  return rows.some((r) => r[1] !== null && Number.isFinite(r[1]));
}

export function profileChart(rows: ProfileRow[], opts: { compare?: ProfileRow[] } = {}): HTMLElement {
  const root = el("div", { class: "profile" });
  if (!hasElevation(rows)) {
    root.append(el("p", { class: "profile-empty" }, "고도 정보 없음"));
    return root;
  }

  const elevs = rows.map((r) => r[1]).filter((v): v is number => v !== null);
  const max = Math.max(...elevs);
  const min = Math.min(...elevs);
  const bands = steepBands(rows);
  const compare = opts.compare && hasElevation(opts.compare) ? opts.compare : null;

  const holder = el("div", { class: "profile-plot" });
  let showCompare = false;

  const draw = (): void => {
    const width = holder.clientWidth || 320;
    const accent = cssVar("--accent", "#1F5FD1");
    const warn = cssVar("--warn", "#9A5B00");
    const short = cssVar("--route-short", "#6B7280");
    const ink = cssVar("--ink", "#1B1F24");
    const all = showCompare && compare ? [...rows, ...compare] : rows;
    const ys = all.map((r) => r[1]).filter((v): v is number => v !== null);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const pad = Math.max(1, (hi - lo) * 0.1);
    const line = (data: ProfileRow[]) => data.filter((r) => r[1] !== null);
    const marks: Plot.Markish[] = [];
    if (bands.length > 0) {
      marks.push(
        Plot.rectX(bands, {
          x1: (b: [number, number]) => b[0],
          x2: (b: [number, number]) => b[1],
          fill: warn,
          fillOpacity: 0.18,
        }),
      );
    }
    if (showCompare && compare) {
      marks.push(
        Plot.line(line(compare), {
          x: (r: ProfileRow) => r[0],
          y: (r: ProfileRow) => r[1],
          stroke: short,
          strokeWidth: 2,
          strokeDasharray: "5 4",
        }),
      );
    }
    marks.push(
      Plot.line(line(rows), {
        x: (r: ProfileRow) => r[0],
        y: (r: ProfileRow) => r[1],
        stroke: accent,
        strokeWidth: 2.5,
      }),
    );
    const svg = Plot.plot({
      width,
      height: 180,
      marginLeft: 44,
      marginRight: 24,
      style: { background: "transparent", color: ink, fontSize: "12px" },
      // 단위는 눈금 글자에 넣는다(축 이름이 마지막 눈금과 겹치지 않게).
      x: { label: null, grid: false, ticks: 5, tickFormat: distTick },
      y: { label: "고도(m)", domain: [lo - pad, hi + pad], grid: true },
      marks,
    });
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `고도 단면 그래프(가로축은 이동 거리). 최고 ${Math.round(max)}m, 최저 ${Math.round(min)}m`);
    holder.replaceChildren(svg);
  };

  root.append(holder);

  if (compare) {
    const btn = el("button", { type: "button", class: "chip", "aria-pressed": "false" }, "최단 경로도 보기");
    btn.addEventListener("click", () => {
      showCompare = !showCompare;
      btn.setAttribute("aria-pressed", String(showCompare));
      draw();
    });
    root.append(btn);
  }

  root.append(
    el(
      "p",
      { class: "profile-summary" },
      `최고 ${Math.round(max)}m · 최저 ${Math.round(min)}m · ${STEEP_PCT}% 이상 구간 ${bands.length}곳`,
    ),
  );

  draw();
  if (typeof ResizeObserver !== "undefined") {
    let lastW = holder.clientWidth;
    new ResizeObserver(() => {
      if (holder.clientWidth && holder.clientWidth !== lastW) {
        lastW = holder.clientWidth;
        draw();
      }
    }).observe(holder);
  }
  return root;
}
