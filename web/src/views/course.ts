import { pointLineDistM } from "../core/geo";
import { setCurrentRoute } from "../core/conditions";
import { loadCourses, loadPois, loadSegments } from "../data/load";
import type { FeatureCollection, Point } from "geojson";
import type { Course, PoiKind, PoiProps, RouteData, RouteMetrics } from "../data/types";
import {
  hasSegments,
  setRouteFocus,
  setSegmentsOpacity,
  showBlockedAt,
  showPois,
  showRoutes,
  showSegments,
  showStops,
} from "../map/layers";
import { el, errorBlock, kvList, loadingBlock, scoreMeter, segmented, type KvRow } from "../ui/components";
import { fmtDelta, fmtM, fmtPct } from "../ui/format";
import { icon } from "../ui/icons";
import { disposeProfileChart, profileChart } from "../ui/profileChart";
import { loadingOverlay, type LoadingOverlay } from "../ui/overlay";
import { conditionsPanel, type ConditionsPanel, type CustomRoute } from "./conditions";
import { fitTo } from "./mapFit";
import { notFoundView } from "./notFound";
import type { AppContext, View } from "./types";

const POI_KINDS: PoiKind[] = ["toilet", "elevator", "bench", "fountain"];
const POI_LABEL: Record<PoiKind, string> = {
  toilet: "화장실",
  elevator: "엘리베이터",
  bench: "벤치",
  fountain: "음수대",
};
const NEAR_M = 300;
/** 코스 화면에서는 경로가 먼저 보이도록 점수 히트맵을 흐리게 둔다. */
const COURSE_HEATMAP_OPACITY = 0.35;
export const CUSTOM_HINT = "아래에서 조건을 바꿔 보세요";

type LngLat = [number, number];
type RouteView = "shortest" | "accessible" | "custom";

export function summarySentence(c: Course): string {
  if (!c.reachable || !c.routes.accessible) return "휠체어로 이어지는 길을 찾지 못했어요";
  const cmp = c.comparison;
  const extra = cmp?.extra_m ?? c.routes.accessible.metrics.length_m - c.routes.shortest.metrics.length_m;
  const steps = cmp?.steps_avoided ?? 0;
  if (steps > 0) return `계단 ${steps}개를 피하는 대신 ${fmtM(extra)} 더 가요`;
  if (extra <= 30) return "최단 경로와 거의 같은 길이에요";
  return `경사와 노면을 고려해 ${fmtM(extra)} 돌아가요`;
}

/** 최단 탭 헤드라인. */
export function shortestSentence(c: Course): string {
  const n = c.routes.shortest.metrics.steps_count;
  return n > 0 ? `가장 짧지만 지나갈 수 없는 계단 ${n}개를 지나요` : "가장 짧은 길이에요";
}

/** 내 조건 탭 헤드라인: 기본 휠체어 경로와의 차이를 한 줄로. */
export function customSentence(base: RouteMetrics, mine: RouteMetrics): string {
  const cobble = (mine.cobble_m ?? 0) - (base.cobble_m ?? 0);
  return `기본 휠체어 경로보다 ${fmtDelta(mine.length_m - base.length_m)} · 돌길 ${fmtDelta(cobble)} · 계단 ${mine.steps_count}개`;
}

function routeBounds(c: Course): [LngLat, LngLat] | null {
  const pts: LngLat[] = [...c.routes.shortest.coords, ...(c.routes.accessible?.coords ?? [])];
  if (c.blocked_at) pts.push(c.blocked_at);
  if (pts.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of pts) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [
    [w, s],
    [e, n],
  ];
}

interface Row {
  label: string;
  get: (r: RouteData) => number | null;
  fmt: (v: number | null) => string;
  /** 값이 작을수록 좋으면 "low". */
  better: "low" | "high";
}

const ROWS: Row[] = [
  { label: "거리", get: (r) => r.metrics.length_m, fmt: (v) => (v === null ? "–" : fmtM(v)), better: "low" },
  { label: "지나갈 수 없는 계단", get: (r) => r.metrics.steps_count, fmt: (v) => (v === null ? "–" : `${v}개`), better: "low" },
  { label: "최대 경사", get: (r) => r.metrics.max_grade_pct, fmt: (v) => fmtPct(v), better: "low" },
  { label: "가파른 길(6% 이상)", get: (r) => r.metrics.steep_m, fmt: (v) => (v === null ? "–" : fmtM(v)), better: "low" },
  { label: "돌길", get: (r) => r.metrics.cobble_m, fmt: (v) => (v === null ? "–" : fmtM(v)), better: "low" },
  {
    label: "평균 점수",
    get: (r) => r.metrics.mean_score,
    fmt: (v) => (v === null ? "–" : `${Math.round(v)}점`),
    better: "high",
  },
  { label: "300m 안 화장실", get: (r) => r.metrics.toilets_300m, fmt: (v) => (v === null ? "–" : `${v}곳`), better: "high" },
];

/** 화면에 보이는 값으로 비교한다. 반올림해서 같아 보이면 더 낫다고 표시하지 않는다. */
export function isBetter(row: Pick<Row, "fmt" | "better">, acc: number | null, short: number | null): boolean {
  if (acc === null || short === null) return false;
  if (row.fmt(acc) === row.fmt(short)) return false;
  return row.better === "low" ? acc < short : acc > short;
}

function comparisonTable(c: Course): HTMLElement {
  const short = c.routes.shortest;
  const acc = c.reachable ? c.routes.accessible : null;
  const table = el("table", { class: "metric-table" });
  table.append(el("caption", {}, acc ? "최단 경로와 휠체어 경로 비교" : "최단 경로 지표"));
  const head = el(
    "tr",
    {},
    el("th", { scope: "col" }, "항목"),
    el("th", { scope: "col", class: "num" }, "최단"),
  );
  if (acc) head.append(el("th", { scope: "col", class: "num" }, "휠체어"));
  table.append(el("thead", {}, head));
  const body = el("tbody");
  for (const row of ROWS) {
    const sv = row.get(short);
    const tr = el("tr", {}, el("th", { scope: "row" }, row.label), el("td", { class: "num" }, row.fmt(sv)));
    if (acc) {
      const av = row.get(acc);
      const better = isBetter(row, av, sv);
      const td = el("td", { class: better ? "num better" : "num" });
      if (better) td.append(el("span", { class: "better-chip", "aria-hidden": "true" }, "✓ 더 나음"));
      td.append(row.fmt(av));
      if (better) td.append(el("span", { class: "visually-hidden" }, " 더 나음"));
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  return table;
}

/** 선택한 탭과 내 조건 결과. 요약 문장·키-값 목록·지도 요약 바가 모두 이것을 따른다. */
export interface Selection {
  view: RouteView;
  custom: CustomRoute | null;
}

/** 경로 요약 행. 굵은 강조는 한 줄만(휠체어: 추가 거리, 최단: 계단, 내 조건: 기본 경로와 차이). */
export function summaryRows(c: Course, sel: Selection, meter: boolean): KvRow[] {
  const acc = c.reachable ? c.routes.accessible : null;
  const score = (v: number | null) => (meter ? scoreMeter(v) : v === null ? "–" : String(Math.round(v)));
  if (sel.view === "shortest" || !acc) {
    const r = c.routes.shortest.metrics;
    return [
      { label: "거리", value: fmtM(r.length_m) },
      { label: "지나갈 수 없는 계단", value: `${r.steps_count}개`, strong: meter && !!acc },
      { label: "최대 경사", value: fmtPct(r.max_grade_pct) },
      { label: "평균 점수", value: score(r.mean_score) },
    ];
  }
  if (sel.view === "custom" && sel.custom) {
    const m = sel.custom.metrics;
    return [
      { label: "거리", value: fmtM(m.length_m) },
      // 지도 요약 바는 한 줄에 들어가도록 짧은 라벨
      { label: meter ? "기본 경로와 차이" : "기본 대비", value: fmtDelta(m.length_m - acc.metrics.length_m), strong: meter },
      { label: "지나갈 수 없는 계단", value: `${m.steps_count}개` },
      { label: "최대 경사", value: fmtPct(m.max_grade_pct) },
      { label: "평균 점수", value: score(m.mean_score) },
    ];
  }
  const extra = c.comparison?.extra_m ?? acc.metrics.length_m - c.routes.shortest.metrics.length_m;
  return [
    { label: "거리", value: fmtM(acc.metrics.length_m) },
    { label: "추가 거리", value: fmtDelta(extra), strong: meter },
    { label: "피한 계단", value: `${c.comparison?.steps_avoided ?? 0}개` },
    { label: "최대 경사", value: fmtPct(acc.metrics.max_grade_pct) },
    { label: "평균 점수", value: score(acc.metrics.mean_score) },
  ];
}

/** 선택한 탭의 헤드라인 문장. */
export function headline(c: Course, sel: Selection): string {
  const acc = c.reachable ? c.routes.accessible : null;
  if (sel.view === "shortest" && acc) return shortestSentence(c);
  if (sel.view === "custom" && acc && sel.custom) return customSentence(acc.metrics, sel.custom.metrics);
  return summarySentence(c);
}

function navLink(c: Course, cityId: string): HTMLElement {
  return el("a", { href: `#/${cityId}/${c.index}/nav`, class: "btn route-nav" }, icon("navigation", 18), "길안내");
}

function stopsList(c: Course): HTMLElement {
  const ol = el("ol", { class: "stop-list" });
  c.stops.forEach((s, i) => {
    ol.append(
      el(
        "li",
        {},
        el("span", { class: "stop-no", "aria-hidden": "true" }, String(i + 1)),
        el("span", {}, s.name),
      ),
    );
  });
  return ol;
}

const FEEL: Record<number, string> = { 1: "아주 쉬움", 2: "쉬움", 3: "보통", 4: "꽤 힘듦", 5: "아주 힘듦" };

/** 탐방팀 현장 기록: 체감 난이도와 만족도(별점), 메모. 계산 점수와 섞지 않는다. */
function fieldCard(c: Course): HTMLElement | null {
  if (!c.field) return null;
  const f = c.field;
  const stars = Math.max(0, Math.min(5, f.stars));
  const card = el(
    "section",
    { class: "field-card", "aria-label": "탐방팀 기록" },
    el("h3", {}, "탐방팀 기록"),
    el("p", { class: "field-feel" }, `탐방팀 체감: ${FEEL[f.difficulty] ?? `${f.difficulty}/5`}`),
    el("p", { class: "field-scale" }, "1 아주 쉬움 · 2 쉬움 · 3 보통 · 4 꽤 힘듦 · 5 아주 힘듦"),
    el(
      "p",
      { class: "field-stars" },
      el("span", { "aria-hidden": "true" }, `만족도 ★${stars}/5`),
      el("span", { class: "visually-hidden" }, `만족도 5점 만점에 ${stars}점`),
    ),
  );
  if (f.note) card.append(el("p", { class: "field-note" }, f.note));
  return card;
}

type PoiFc = FeatureCollection<Point, PoiProps>;

/** 경로에서 NEAR_M 안에 있는 편의시설만 고른다. */
export function poisNear(fc: PoiFc, line: LngLat[]): PoiFc {
  const out: PoiFc = { type: "FeatureCollection", features: [] };
  if (line.length === 0) return out;
  // 먼저 경로 상자(+300m)로 걸러 거리 계산 횟수를 줄인다.
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of line) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  const dLat = NEAR_M / 111320;
  const dLon = NEAR_M / (111320 * Math.max(0.01, Math.cos((((s + n) / 2) * Math.PI) / 180)));
  for (const f of fc.features) {
    const [x, y] = f.geometry.coordinates as LngLat;
    if (x < w - dLon || x > e + dLon || y < s - dLat || y > n + dLat) continue;
    if (pointLineDistM([x, y], line) <= NEAR_M) out.features.push(f);
  }
  return out;
}

export function courseView(cityId: string, courseIndex: number): View {
  let inner: View | null = null;
  let profileHolderRef: HTMLElement | null = null;
  let touchedMap = false;
  let mapRef: AppContext["map"] | null = null;
  let panel: ConditionsPanel | null = null;
  let bar: HTMLElement | null = null;
  let overlay: LoadingOverlay | null = null;

  return {
    async mount(ctx: AppContext) {
      const city = ctx.index.cities.find((c) => c.id === cityId);
      if (!city) {
        inner = notFoundView();
        inner.mount(ctx);
        return;
      }
      mapRef = ctx.map;

      const loadAll = async (): Promise<void> => {
        ctx.sheet.setContent(loadingBlock("코스를 불러오는 중"));
        let courses: Course[];
        try {
          courses = await loadCourses(city);
        } catch {
          if (ctx.signal.aborted) return;
          ctx.sheet.setContent(errorBlock("코스 정보를 불러오지 못했어요.", () => void loadAll()));
          return;
        }
        if (ctx.signal.aborted) return;
        const course = courses.find((c) => c.index === courseIndex);
        if (!course) {
          inner = notFoundView();
          inner.mount(ctx);
          return;
        }
        render(course);
      };

      // 코스 주소로 바로 들어오면 히트맵이 아직 없으므로 여기서 불러온다. 도시 화면에서 왔으면 이미 있다.
      const loadHeatmap = (): void => {
        if (overlay) overlay.loading();
        else overlay = loadingOverlay(ctx.shell.mapContainer, `${city.name_ko} 길 데이터를 불러오는 중…`);
        loadSegments(city).then(
          (fc) => {
            if (ctx.signal.aborted) return;
            overlay?.remove();
            overlay = null;
            if (hasSegments(ctx.map)) return;
            showSegments(ctx.map, fc, null);
          },
          () => {
            if (ctx.signal.aborted) return;
            overlay?.fail("길 데이터를 불러오지 못했어요.", loadHeatmap);
          },
        );
      };

      const render = (course: Course): void => {
        ctx.shell.setTitle(course.name, [{ label: city.name_ko, href: `#/${cityId}` }]);
        ctx.sheet.setSnap("half");
        const acc = course.reachable ? course.routes.accessible : null;
        touchedMap = true;
        setSegmentsOpacity(ctx.map, COURSE_HEATMAP_OPACITY);
        showRoutes(ctx.map, course.routes.shortest.coords, acc?.coords ?? null);
        showStops(ctx.map, course.stops);
        showBlockedAt(ctx.map, course.reachable ? null : course.blocked_at);
        const initial = acc ?? course.routes.shortest;
        setCurrentRoute(cityId, course.index, { coords: initial.coords, segIds: initial.seg_ids, source: "default" });
        if (!hasSegments(ctx.map)) loadHeatmap();
        const bounds = routeBounds(course);
        if (bounds) fitTo(ctx, bounds);

        const sel: Selection = { view: acc ? "accessible" : "shortest", custom: null };
        const selectedLine = (): LngLat[] => {
          if (sel.view === "shortest" || !acc) return course.routes.shortest.coords;
          if (sel.view === "custom" && sel.custom) return sel.custom.coords;
          return acc.coords;
        };

        const root = el("div", { class: "course", "data-view": sel.view });
        if (course.approximate) {
          root.append(
            el(
              "p",
              { class: "notice notice-warn", role: "note" },
              el("strong", {}, "위치 오차 있음"),
              ` · 정류장이 실제 위치와 최대 ${Math.round(course.snap_max_m)}m 떨어져 있어요`,
            ),
          );
        }

        // ----- 경로 보기 탭: 최단 / 휠체어 / 내 조건. 이 탭 하나가 요약·지도·내 조건 패널을 바꾼다. -----
        const condId = `cond-${city.id}-${course.index}`;
        if (acc) {
          const tabs = segmented<RouteView>(
            [
              { value: "shortest", label: "최단" },
              { value: "accessible", label: "휠체어" },
              { value: "custom", label: "내 조건" },
            ],
            "accessible",
            (v) => select(v),
            "경로 보기",
          );
          tabs.el.querySelector('[data-value="custom"]')?.setAttribute("aria-controls", condId);
          root.append(tabs.el);
        }

        // ----- 요약: 헤드라인 + 키-값 목록(+ 좁은 화면 길안내 버튼). 넓은 화면은 지도 아래 요약 바 -----
        // 헤드라인은 .course의 직계 자식이어야 내 조건 탭에서 스크롤해도 위에 붙어 있다(sticky).
        const sentence = el("p", { class: "course-summary", "aria-live": "polite" });
        const hint = el("p", { class: "route-hint" }, CUSTOM_HINT);
        const kvBox = el("div", { class: "route-kv" });
        root.append(
          sentence,
          el(
            "section",
            { class: "route-summary", "aria-label": "경로 요약" },
            hint,
            kvBox,
            el("div", { class: "route-summary-row" }, navLink(course, cityId)),
          ),
        );
        const barKv = el("div", { class: "route-bar-kv" });
        bar?.remove();
        bar = el("section", { class: "route-bar", "aria-label": "지도 경로 요약" }, barKv, navLink(course, cityId));
        ctx.shell.mapContainer.append(bar);
        setRouteFocus(ctx.map, "accessible");

        panel?.destroy();
        panel = null;
        if (acc) {
          panel = conditionsPanel({
            ctx,
            city,
            course,
            onProfile: (rows) => drawProfile(rows),
            onResult: (r) => {
              sel.custom = r;
              update();
            },
          });
          root.append(panel.el);
        }

        const table = comparisonTable(course);
        root.append(table);

        root.append(el("h3", { class: "section-title" }, "오르막·내리막"));
        const profileHolder = el("div", { class: "profile-holder" });
        const drawProfile = (rows: RouteData["profile"]): void => {
          disposeProfileChart(profileHolder.firstElementChild);
          profileHolder.replaceChildren(
            profileChart(rows, acc ? { compare: course.routes.shortest.profile } : {}),
          );
        };
        drawProfile((acc ?? course.routes.shortest).profile);
        root.append(profileHolder);
        profileHolderRef = profileHolder;

        root.append(el("h3", { class: "section-title" }, "정류장"), stopsList(course));

        const poiBox = el("div", { class: "poi-near", "aria-live": "polite" }, "편의시설을 확인하는 중");
        root.append(el("h3", { class: "section-title" }, `경로 ${NEAR_M}m 안 편의시설`), poiBox);

        const field = fieldCard(course);
        if (field) root.append(field);

        // 지도와 목록 모두 선택한 경로 300m 안 편의시설만 보인다.
        let allPois: PoiFc | null = null;
        const updatePois = (): void => {
          if (!allPois) return;
          const near = poisNear(allPois, selectedLine());
          showPois(ctx.map, near);
          const counts = new Map<PoiKind, number>();
          for (const f of near.features) counts.set(f.properties.kind, (counts.get(f.properties.kind) ?? 0) + 1);
          const items = POI_KINDS.filter((k) => (counts.get(k) ?? 0) > 0).map((k) =>
            el("li", {}, `${POI_LABEL[k]} ${counts.get(k)}곳`),
          );
          poiBox.replaceChildren(
            items.length > 0 ? el("ul", {}, ...items) : el("p", {}, `경로 ${NEAR_M}m 안에 편의시설이 없어요`),
          );
        };

        function update(): void {
          root.dataset.view = sel.view;
          sentence.textContent = headline(course, sel);
          hint.hidden = !(sel.view === "custom" && !sel.custom);
          kvBox.replaceChildren(kvList(summaryRows(course, sel, true)));
          barKv.replaceChildren(kvList(summaryRows(course, sel, false), "kv-inline"));
          // 내 조건에서는 최단 대비 표 대신 패널의 기본 경로 대비 차이 표만 보인다.
          table.hidden = sel.view === "custom";
          updatePois();
        }

        function select(v: RouteView): void {
          sel.view = v;
          setRouteFocus(ctx.map, v === "shortest" ? "shortest" : "accessible");
          // 내 조건 탭을 떠나면 패널을 닫고 기본 경로와 내보낸 히트맵으로 되돌린다(onResult(null)이 불린다).
          if (v === "custom") panel?.activate();
          else panel?.deactivate();
          update();
        }

        update();
        ctx.sheet.setContent(root);

        const loadPoiData = (): void => {
          loadPois(city).then(
            (fc) => {
              if (ctx.signal.aborted) return;
              allPois = fc as PoiFc;
              updatePois();
            },
            () => {
              if (ctx.signal.aborted) return;
              poiBox.replaceChildren(
                errorBlock("편의시설 정보를 불러오지 못했어요.", () => {
                  poiBox.replaceChildren("편의시설을 확인하는 중");
                  loadPoiData();
                }),
              );
            },
          );
        };
        loadPoiData();
      };

      await loadAll();
    },
    unmount() {
      disposeProfileChart(profileHolderRef?.firstElementChild);
      profileHolderRef = null;
      inner?.unmount();
      inner = null;
      panel?.destroy();
      panel = null;
      bar?.remove();
      bar = null;
      overlay?.remove();
      overlay = null;
      if (touchedMap && mapRef) {
        setRouteFocus(mapRef, "accessible");
        setSegmentsOpacity(mapRef, 1);
        showRoutes(mapRef, null, null);
        showStops(mapRef, []);
        showBlockedAt(mapRef, null);
      }
      touchedMap = false;
    },
  };
}
