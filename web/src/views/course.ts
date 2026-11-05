import { pointLineDistM } from "../core/geo";
import { setCurrentRoute } from "../core/conditions";
import { loadCourses, loadPois, loadSegments } from "../data/load";
import type { Course, PoiKind, RouteData } from "../data/types";
import { hasSegments, setRouteFocus, showBlockedAt, showRoutes, showSegments, showStops } from "../map/layers";
import { el, errorBlock, kvList, loadingBlock, scoreMeter, segmented, type KvRow, type Segmented } from "../ui/components";
import { fmtDelta, fmtM, fmtPct } from "../ui/format";
import { icon } from "../ui/icons";
import { disposeProfileChart, profileChart } from "../ui/profileChart";
import { conditionsPanel, type ConditionsPanel } from "./conditions";
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

function isBetter(row: Row, acc: number | null, short: number | null): boolean {
  if (acc === null || short === null) return false;
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
      const td = el("td", { class: better ? "num better" : "num" }, row.fmt(av));
      if (better) td.append(el("span", { class: "visually-hidden" }, " 더 나음"));
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  return table;
}

/** 경로 요약 행: 거리 · 추가 거리 · 피한 계단 · 최대 경사 · 평균 점수. 굵은 강조는 추가 거리 하나만. */
function summaryRows(c: Course, meter: boolean): KvRow[] {
  const acc = c.reachable ? c.routes.accessible : null;
  const r = acc ?? c.routes.shortest;
  const rows: KvRow[] = [{ label: "거리", value: fmtM(r.metrics.length_m) }];
  if (acc) {
    const extra = c.comparison?.extra_m ?? acc.metrics.length_m - c.routes.shortest.metrics.length_m;
    rows.push({ label: "추가 거리", value: fmtDelta(extra), strong: meter });
    rows.push({ label: "피한 계단", value: `${c.comparison?.steps_avoided ?? 0}개` });
  }
  rows.push({ label: "최대 경사", value: fmtPct(r.metrics.max_grade_pct) });
  const score = r.metrics.mean_score;
  rows.push({
    label: "평균 점수",
    value: meter ? scoreMeter(score) : score === null ? "–" : String(Math.round(score)),
  });
  return rows;
}

/** 패널 위 헤드라인과 키-값 목록(sheet), 또는 지도 아래 떠 있는 요약 바(map). */
function routeSummary(c: Course, cityId: string, variant: "sheet" | "map"): HTMLElement {
  const nav = el("a", { href: `#/${cityId}/${c.index}/nav`, class: "btn route-nav" }, icon("navigation", 18), "길안내");
  if (variant === "map") {
    return el(
      "section",
      { class: "route-bar", "aria-label": "경로 요약" },
      kvList(summaryRows(c, false), "kv-inline"),
      nav,
    );
  }
  return el(
    "section",
    { class: "route-summary", "aria-label": "경로 요약" },
    el("p", { class: "course-summary" }, summarySentence(c)),
    kvList(summaryRows(c, true)),
    el("div", { class: "route-summary-row" }, nav),
  );
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

function countNearby(
  fc: { features: { geometry: { coordinates: number[] }; properties: { kind: PoiKind } }[] },
  line: LngLat[],
): Map<PoiKind, number> {
  const counts = new Map<PoiKind, number>();
  if (line.length === 0) return counts;
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
    const [x, y] = f.geometry.coordinates;
    if (x < w - dLon || x > e + dLon || y < s - dLat || y > n + dLat) continue;
    if (pointLineDistM([x, y], line) <= NEAR_M) {
      counts.set(f.properties.kind, (counts.get(f.properties.kind) ?? 0) + 1);
    }
  }
  return counts;
}

export function courseView(cityId: string, courseIndex: number): View {
  let inner: View | null = null;
  let profileHolderRef: HTMLElement | null = null;
  let touchedMap = false;
  let mapRef: AppContext["map"] | null = null;
  let panel: ConditionsPanel | null = null;
  let bar: HTMLElement | null = null;

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

      const render = (course: Course): void => {
        ctx.shell.setTitle(course.name, [{ label: city.name_ko, href: `#/${cityId}` }]);
        ctx.sheet.setSnap("half");
        const acc = course.reachable ? course.routes.accessible : null;
        touchedMap = true;
        showRoutes(ctx.map, course.routes.shortest.coords, acc?.coords ?? null);
        showStops(ctx.map, course.stops);
        showBlockedAt(ctx.map, course.reachable ? null : course.blocked_at);
        const initial = acc ?? course.routes.shortest;
        setCurrentRoute(cityId, course.index, { coords: initial.coords, segIds: initial.seg_ids, source: "default" });
        // 코스 주소로 바로 들어오면 히트맵이 아직 없으므로 여기서 불러온다. 도시 화면에서 왔으면 이미 있다.
        if (!hasSegments(ctx.map)) {
          loadSegments(city).then(
            (fc) => {
              if (ctx.signal.aborted || hasSegments(ctx.map)) return;
              showSegments(ctx.map, fc, null);
            },
            () => {},
          );
        }
        const bounds = routeBounds(course);
        if (bounds) fitTo(ctx, bounds);

        const root = el("div", { class: "course" });
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
        root.append(routeSummary(course, cityId, "sheet"));
        bar?.remove();
        bar = routeSummary(course, cityId, "map");
        ctx.shell.mapContainer.append(bar);
        setRouteFocus(ctx.map, "accessible");

        const change = el("button", { type: "button", class: "btn btn-quiet" }, "내 조건으로 경로 바꾸기");
        let tabs: Segmented<RouteView> | null = null;
        if (acc) {
          tabs = segmented<RouteView>(
            [
              { value: "shortest", label: "최단" },
              { value: "accessible", label: "휠체어" },
              { value: "custom", label: "내 조건" },
            ],
            "accessible",
            (v) => {
              setRouteFocus(ctx.map, v === "shortest" ? "shortest" : "accessible");
              if (v === "accessible") panel?.deactivate();
              else if (v === "custom") panel?.activate();
            },
            "지도에 강조할 경로",
          );
          root.append(tabs.el);
        }
        root.append(el("div", { class: "course-actions" }, change));
        panel?.destroy();
        panel = null;
        if (acc) {
          panel = conditionsPanel({
            ctx,
            city,
            course,
            button: change,
            onProfile: (rows) => drawProfile(rows),
            onOpenChange: (open) => {
              if (!open || !tabs) return;
              tabs.set("custom");
              setRouteFocus(ctx.map, "accessible");
            },
          });
          root.append(panel.el);
        } else {
          change.setAttribute("disabled", "");
          change.setAttribute("aria-disabled", "true");
        }

        root.append(comparisonTable(course));

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

        ctx.sheet.setContent(root);

        const loadPoiCounts = (): void => {
          loadPois(city).then(
            (fc) => {
              if (ctx.signal.aborted) return;
              const line = (acc ?? course.routes.shortest).coords;
              const counts = countNearby(fc as never, line);
              const items = POI_KINDS.filter((k) => (counts.get(k) ?? 0) > 0).map((k) =>
                el("li", {}, `${POI_LABEL[k]} ${counts.get(k)}곳`),
              );
              poiBox.replaceChildren(
                items.length > 0 ? el("ul", {}, ...items) : el("p", {}, `경로 ${NEAR_M}m 안에 편의시설이 없어요`),
              );
            },
            () => {
              if (ctx.signal.aborted) return;
              poiBox.replaceChildren(errorBlock("편의시설 정보를 불러오지 못했어요.", () => {
                poiBox.replaceChildren("편의시설을 확인하는 중");
                loadPoiCounts();
              }));
            },
          );
        };
        loadPoiCounts();
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
      if (touchedMap && mapRef) {
        setRouteFocus(mapRef, "accessible");
        showRoutes(mapRef, null, null);
        showStops(mapRef, []);
        showBlockedAt(mapRef, null);
      }
      touchedMap = false;
    },
  };
}
