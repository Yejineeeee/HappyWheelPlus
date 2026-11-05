import * as Plot from "@observablehq/plot";
import type { CityIndex, SurfaceClass } from "../data/types";
import { showCityMarkers } from "../map/layers";
import { scoreColor } from "../map/style";
import {
  POI_KINDS,
  POI_LABEL,
  SURFACE_LABEL,
  SURFACE_ORDER,
  coverageRows,
  coverageSentence,
  poiDensityRows,
  poiSentence,
  scoreSentence,
  sortedScores,
  surfaceMixRows,
  surfaceSentence,
} from "../ui/charts";
import { el } from "../ui/components";
import { cssVar } from "../ui/profileChart";
import { fitTo } from "./mapFit";
import type { AppContext, View } from "./types";

const BAR_H = 26;

function surfaceColors(): Record<SurfaceClass, string> {
  // 점수 팔레트를 매끈함(좋음) → 비포장(나쁨) 순으로 쓰고, 정보 없음만 회색.
  return {
    smooth: "#7ad151",
    paving: "#22a884",
    compacted: "#2a788e",
    cobble: "#414487",
    unpaved: "#440154",
    unknown: cssVar("--muted", "#5B636E"),
  };
}

function dataTable(caption: string, head: string[], rows: string[][]): HTMLElement {
  const table = el("table", { class: "metric-table chart-table" }, el("caption", {}, caption));
  const tr = el("tr", {});
  head.forEach((h, i) => tr.append(el("th", { scope: "col", class: i > 0 ? "num" : "" }, h)));
  table.append(el("thead", {}, tr));
  const body = el("tbody");
  for (const r of rows) {
    const row = el("tr", {}, el("th", { scope: "row" }, r[0]));
    r.slice(1).forEach((v) => row.append(el("td", { class: "num" }, v)));
    body.append(row);
  }
  table.append(body);
  return table;
}

interface ChartSpec {
  id: string;
  title: string;
  sentence: string;
  legend?: HTMLElement;
  table: HTMLElement;
  draw(width: number): Element;
}

function chartBlock(spec: ChartSpec): { node: HTMLElement; redraw(): void } {
  const plotBox = el("div", { class: "chart-plot", role: "img", "aria-label": `${spec.title}. ${spec.sentence}` });
  const tableBox = el("div", { class: "chart-table-wrap", id: `${spec.id}-table`, hidden: "" }, spec.table);
  const toggle = el(
    "button",
    { type: "button", class: "chip chart-toggle", "aria-expanded": "false", "aria-controls": `${spec.id}-table` },
    "표로 보기",
  );
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "표 닫기" : "표로 보기";
    tableBox.hidden = !open;
  });
  const node = el("section", { class: "chart-block" }, el("h2", {}, spec.title), el("p", { class: "chart-note" }, spec.sentence));
  if (spec.legend) node.append(spec.legend);
  node.append(plotBox, toggle, tableBox);
  const redraw = () => {
    const out = spec.draw(plotBox.clientWidth || 320);
    out.setAttribute("aria-hidden", "true");
    plotBox.replaceChildren(out);
  };
  return { node, redraw };
}

function legendList(items: { label: string; color: string; shape?: "dot" | "diamond" }[]): HTMLElement {
  const ul = el("ul", { class: "chart-legend" });
  for (const it of items) {
    const cls = it.shape ? `chart-swatch ${it.shape}` : "chart-swatch";
    const sw = el("span", { class: cls, "aria-hidden": "true" });
    sw.style.background = it.color;
    ul.append(el("li", {}, sw, it.label));
  }
  return ul;
}

function commonOpts(width: number, rows: number, marginRight = 12) {
  return {
    width,
    height: rows * BAR_H + 44,
    marginLeft: 64,
    marginRight,
    marginBottom: 28,
    style: { background: "transparent", color: cssVar("--ink", "#1B1F24"), fontSize: "12px" },
  };
}

function buildCharts(index: CityIndex): { node: HTMLElement; redraw(): void }[] {
  const scores = sortedScores(index);
  const order = scores.map((s) => s.city);
  const n = order.length;
  const mix = surfaceMixRows(index);
  const poi = poiDensityRows(index);
  const cov = coverageRows(index);
  const ink = () => cssVar("--ink", "#1B1F24");

  const scoreChart = chartBlock({
    id: "chart-score",
    title: "평균 점수",
    sentence: scoreSentence(index),
    table: dataTable("도시별 평균 점수", ["도시", "평균 점수"], scores.map((s) => [s.city, `${s.score.toFixed(1)}점`])),
    draw: (w) =>
      Plot.plot({
        ...commonOpts(w, n, 32),
        x: { label: null, domain: [0, 100], grid: true },
        y: { label: null, domain: order },
        marks: [
          Plot.barX(scores, { x: "score", y: "city", fill: (d: { score: number }) => scoreColor(d.score) }),
          Plot.text(scores, {
            x: "score",
            y: "city",
            text: (d: { score: number }) => `${Math.round(d.score)}`,
            dx: 4,
            textAnchor: "start",
            fill: ink(),
          }),
        ],
      }),
  });

  const colors = surfaceColors();
  const surfaceChart = chartBlock({
    id: "chart-surface",
    title: "노면 구성",
    sentence: surfaceSentence(index),
    legend: legendList(SURFACE_ORDER.map((c) => ({ label: SURFACE_LABEL[c], color: colors[c] }))),
    table: dataTable(
      "도시별 노면 구성(길이 기준 비율)",
      ["도시", ...SURFACE_ORDER.map((c) => SURFACE_LABEL[c])],
      order.map((city) => [
        city,
        ...SURFACE_ORDER.map((c) => {
          const r = mix.find((m) => m.city === city && m.cls === c);
          return `${((r?.share ?? 0) * 100).toFixed(1)}%`;
        }),
      ]),
    ),
    draw: (w) =>
      Plot.plot({
        ...commonOpts(w, n),
        x: { label: null, domain: [0, 1], tickFormat: (d: number) => `${Math.round(d * 100)}%`, grid: true },
        y: { label: null, domain: order },
        color: { domain: SURFACE_ORDER, range: SURFACE_ORDER.map((c) => colors[c]) },
        marks: [Plot.barX(mix, { x: "share", y: "city", fill: "cls", stroke: cssVar("--surface", "#ffffff"), strokeWidth: 1 })],
      }),
  });

  const poiChart = chartBlock({
    id: "chart-poi",
    title: "㎢당 편의시설",
    sentence: poiSentence(index),
    table: dataTable(
      "도시별 ㎢당 편의시설 수",
      ["도시", ...POI_KINDS.map((k) => POI_LABEL[k])],
      order.map((city) => [
        city,
        ...POI_KINDS.map((k) => (poi.find((p) => p.city === city && p.kind === k)?.perKm2 ?? 0).toFixed(1)),
      ]),
    ),
    draw: (w) => {
      // 벤치가 다른 시설보다 훨씬 많아 종류마다 가로축을 따로 둔 작은 그래프로 나눈다.
      const grid = el("div", { class: "chart-small-multiples" });
      for (const kind of POI_KINDS) {
        const rows = poi.filter((p) => p.kind === kind);
        grid.append(
          el(
            "figure",
            { class: "chart-small" },
            el("figcaption", {}, POI_LABEL[kind]),
            Plot.plot({
              ...commonOpts(w, n, 44),
              x: { label: null, grid: true, ticks: 4 },
              y: { label: null, domain: order },
              marks: [
                Plot.barX(rows, { x: "perKm2", y: "city", fill: cssVar("--accent", "#1F5FD1") }),
                Plot.text(rows, {
                  x: "perKm2",
                  y: "city",
                  text: (d: { perKm2: number }) => d.perKm2.toFixed(1),
                  dx: 4,
                  textAnchor: "start",
                  fill: ink(),
                }),
              ],
            }),
          ),
        );
      }
      return grid;
    },
  });

  const accent = cssVar("--accent", "#1F5FD1");
  const warn = cssVar("--warn", "#9A5B00");
  const trustChart = chartBlock({
    id: "chart-trust",
    title: "데이터 신뢰도",
    sentence: coverageSentence(index),
    legend: legendList([
      { label: "노면 정보 비율", color: accent, shape: "dot" },
      { label: "경사 정보 비율", color: warn, shape: "diamond" },
    ]),
    table: dataTable(
      "도시별 정보가 있는 길의 비율(길이 기준)",
      ["도시", "노면 정보", "경사 정보"],
      order.map((city) => {
        const f = (m: "surface" | "slope") =>
          `${((cov.find((c) => c.city === city && c.metric === m)?.share ?? 0) * 100).toFixed(1)}%`;
        return [city, f("surface"), f("slope")];
      }),
    ),
    draw: (w) =>
      Plot.plot({
        ...commonOpts(w, n),
        x: { label: null, domain: [0, 100], tickFormat: (d: number) => `${d}%`, grid: true },
        y: { label: null, domain: order },
        symbol: { domain: ["surface", "slope"], range: ["circle", "diamond"] },
        color: { domain: ["surface", "slope"], range: [accent, warn] },
        marks: [
          Plot.dot(cov, {
            x: (d: { share: number }) => d.share * 100,
            y: "city",
            fill: "metric",
            symbol: "metric",
            r: 5,
          }),
        ],
      }),
  });

  return [scoreChart, surfaceChart, poiChart, trustChart];
}

/**
 * 비교 화면: 시트에 차트 4개를 담는다.
 * 좁은 화면에서는 시트를 "full"로 펼쳐 내용이 지도를 덮고, 넓은 화면에서는 왼쪽 패널에
 * 내용을, 오른쪽 지도에 홈과 같은 도시 점수 마커를 보여 준다(마커를 누르면 도시로 이동).
 */
export function compareView(): View {
  let observer: ResizeObserver | null = null;
  let restoreSnap: (() => void) | null = null;
  return {
    mount(ctx: AppContext) {
      ctx.shell.setTitle("도시 비교", "#/");
      const prevSnap = ctx.sheet.snap();
      restoreSnap = () => ctx.sheet.setSnap(prevSnap);

      const charts = buildCharts(ctx.index);
      const root = el("div", { class: "compare" });
      root.append(
        el("p", { class: "intro" }, "9개 도시의 보행 네트워크를 같은 기준으로 비교했어요. 점수는 높을수록 휠체어로 다니기 쉬워요."),
      );
      for (const c of charts) root.append(c.node);
      ctx.sheet.setContent(root);
      ctx.sheet.setSnap("full");

      const redrawAll = () => charts.forEach((c) => c.redraw());
      redrawAll();
      if (typeof ResizeObserver !== "undefined") {
        let lastW = root.clientWidth;
        observer = new ResizeObserver(() => {
          if (root.clientWidth && root.clientWidth !== lastW) {
            lastW = root.clientWidth;
            redrawAll();
          }
        });
        observer.observe(root);
      }

      const { cities } = ctx.index;
      showCityMarkers(ctx.map, cities, (id) => ctx.navigate({ name: "city", city: id }));
      if (cities.length > 0) {
        const lons = cities.map((c) => c.center[0]);
        const lats = cities.map((c) => c.center[1]);
        fitTo(ctx, [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ]);
      }
    },
    unmount() {
      observer?.disconnect();
      observer = null;
      restoreSnap?.();
      restoreSnap = null;
    },
  };
}
