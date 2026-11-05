import { HOME_CRUMB } from "../ui/shell";
import type { CityIndex, SurfaceClass } from "../data/types";
import { highlightCityMarker, showCityMarkers } from "../map/layers";
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
import { el, errorBlock, loadingBlock } from "../ui/components";
import { loadPlot, type PlotModule } from "../ui/plot";
import { cssVar } from "../ui/profileChart";
import { fitTo } from "./mapFit";
import type { AppContext, View } from "./types";

const BAR_H = 26;

function surfaceColors(): Record<SurfaceClass, string> {
  // 매끈함(초록·청록 계열) → 돌길·비포장(황갈색·적갈색) 순. 어두운 보라 둘이 구분되지 않던 문제를 피하고, 정보 없음만 회색.
  return {
    smooth: "#7ad151",
    paving: "#22a884",
    compacted: "#2a788e",
    cobble: "#b7791f",
    unpaved: "#a8320a",
    unknown: cssVar("--muted", "#5B636E"),
  };
}

function dataTable(caption: string, head: string[], rows: (string | Node)[][]): HTMLElement {
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
  /** 그래프 하나(svg)의 막대·점 순서대로 그 도시 이름. 마우스를 올리면 지도 마커를 강조한다. */
  marksCities?: string[];
}

type Hover = (cityName: string | null) => void;

/** 막대·점(첫 데이터 표시 묶음)에 마우스를 올리면 그 도시를 알린다. */
function bindHover(out: Element, names: string[], onHover: Hover): void {
  const svgs = out.tagName.toLowerCase() === "svg" ? [out] : [...out.querySelectorAll("svg")];
  for (const svg of svgs) {
    const group = svg.querySelector('g[aria-label="bar"], g[aria-label="dot"]');
    if (!group) continue;
    [...group.children].forEach((mark, i) => {
      const name = names[i];
      if (!name) return;
      mark.addEventListener("pointerenter", () => onHover(name));
      mark.addEventListener("pointerleave", () => onHover(null));
    });
  }
}

function chartBlock(spec: ChartSpec, onHover: Hover): { node: HTMLElement; redraw(): void } {
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
    if (spec.marksCities) bindHover(out, spec.marksCities, onHover);
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

function buildCharts(Plot: PlotModule, index: CityIndex, onHover: Hover): { node: HTMLElement; redraw(): void }[] {
  const scores = sortedScores(index);
  const order = scores.map((s) => s.city);
  const n = order.length;
  const mix = surfaceMixRows(index);
  const poi = poiDensityRows(index);
  const cov = coverageRows(index);
  const ink = () => cssVar("--ink", "#1B1F24");

  // 점수 표의 도시 이름은 도시 화면 링크다. 포커스하거나 마우스를 올리면 지도 마커를 강조한다.
  const cityLink = (id: string, name: string): HTMLElement => {
    const a = el("a", { href: `#/${id}` }, name);
    a.addEventListener("focus", () => onHover(name));
    a.addEventListener("blur", () => onHover(null));
    a.addEventListener("pointerenter", () => onHover(name));
    a.addEventListener("pointerleave", () => onHover(null));
    return a;
  };
  const scoreChart = chartBlock({
    id: "chart-score",
    title: "평균 점수",
    sentence: scoreSentence(index),
    marksCities: order,
    table: dataTable(
      "도시별 평균 점수",
      ["도시", "평균 점수"],
      scores.map((s) => [cityLink(s.id, s.city), `${s.score.toFixed(1)}점`]),
    ),
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
  }, onHover);

  const colors = surfaceColors();
  const surfaceChart = chartBlock({
    id: "chart-surface",
    title: "노면 구성",
    sentence: surfaceSentence(index),
    marksCities: mix.map((m) => m.city),
    legend: legendList(SURFACE_ORDER.map((c) => ({ label: SURFACE_LABEL[c], color: c === "unknown" ? "var(--muted)" : colors[c] }))),
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
  }, onHover);

  const poiChart = chartBlock({
    id: "chart-poi",
    title: "1㎢마다 편의시설",
    sentence: poiSentence(index),
    marksCities: order,
    table: dataTable(
      "도시별 1㎢마다 편의시설 수",
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
  }, onHover);

  const accent = cssVar("--accent", "#1F5FD1");
  const warn = cssVar("--warn", "#9A5B00");
  const trustChart = chartBlock({
    id: "chart-trust",
    title: "정보가 있는 길",
    sentence: coverageSentence(index),
    marksCities: cov.map((c) => c.city),
    legend: legendList([
      { label: "노면이 기록된 길", color: "var(--accent)", shape: "dot" },
      { label: "경사를 잰 길", color: "var(--warn)", shape: "diamond" },
    ]),
    table: dataTable(
      "도시별 정보가 있는 길의 비율(길이 기준)",
      ["도시", "노면이 기록된 길", "경사를 잰 길"],
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
  }, onHover);

  return [scoreChart, surfaceChart, poiChart, trustChart];
}

/**
 * 비교 화면: 시트에 차트 4개를 담는다.
 * 좁은 화면에서는 시트를 "full"로 펼쳐 내용이 지도를 덮고, 넓은 화면에서는 왼쪽 패널에
 * 내용을, 오른쪽 지도에 홈과 같은 도시 점수 마커를 보여 준다(마커를 누르면 도시로 이동).
 */
export function compareView(): View {
  let observer: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let restoreSnap: (() => void) | null = null;
  return {
    async mount(ctx: AppContext) {
      ctx.shell.setTitle("도시 비교", [HOME_CRUMB]);
      const prevSnap = ctx.sheet.snap();
      restoreSnap = () => ctx.sheet.setSnap(prevSnap);

      let Plot: PlotModule;
      try {
        ctx.sheet.setContent(loadingBlock("그래프를 준비하는 중"));
        Plot = await loadPlot();
      } catch {
        if (ctx.signal.aborted) return;
        ctx.sheet.setContent(errorBlock("그래프를 불러오지 못했어요.", () => void this.mount(ctx)));
        return;
      }
      if (ctx.signal.aborted) return;
      const idByName = new Map(ctx.index.cities.map((c) => [c.name_ko, c.id]));
      const charts = buildCharts(Plot, ctx.index, (name) => {
        highlightCityMarker(ctx.map, name === null ? null : (idByName.get(name) ?? null));
      });
      const root = el("div", { class: "compare" });
      root.append(
        el("p", { class: "intro" }, `${ctx.index.cities.length}개 도시의 길을 같은 기준으로 비교했어요. 점수는 높을수록 휠체어로 다니기 쉬워요.`),
      );
      for (const c of charts) root.append(c.node);
      ctx.sheet.setContent(root);
      ctx.sheet.setSnap("full");

      const redrawAll = () => charts.forEach((c) => c.redraw());
      redrawAll();
      // 테마를 바꾸면 SVG에 박힌 색이 낡으므로 data-theme이 바뀔 때 다시 그린다.
      if (typeof MutationObserver !== "undefined") {
        themeObserver = new MutationObserver(redrawAll);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      }
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
      themeObserver?.disconnect();
      themeObserver = null;
      restoreSnap?.();
      restoreSnap = null;
    },
  };
}
