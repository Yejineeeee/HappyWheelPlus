import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CityEntry, CityIndex, Course } from "../src/data/types";
import unreachable from "./fixtures/courses_unreachable.json";

vi.mock("../src/data/load", () => ({
  loadCourses: vi.fn(),
  loadSegments: vi.fn(),
  loadPois: vi.fn(),
  loadGraph: vi.fn(),
}));
vi.mock("../src/map/layers", () => ({
  showRoutes: vi.fn(),
  showStops: vi.fn(),
  showBlockedAt: vi.fn(),
  setRouteFocus: vi.fn(),
  setSegmentsOpacity: vi.fn(),
  showPois: vi.fn(),
  showSegments: vi.fn(),
  hasSegments: vi.fn(),
}));

import { loadCourses, loadGraph, loadPois, loadSegments } from "../src/data/load";
import { hasSegments, setRouteFocus, setSegmentsOpacity, showBlockedAt, showPois, showRoutes, showSegments, showStops } from "../src/map/layers";
import { profileChart } from "../src/ui/profileChart";
import { mountSheet } from "../src/ui/sheet";
import { courseView, customSentence, isBetter, shortestSentence } from "../src/views/course";
import type { AppContext } from "../src/views/types";

const CITY: CityEntry = {
  id: "paris",
  name_ko: "파리",
  country_ko: "프랑스",
  center: [2, 48],
  radius_m: 2000,
  data_version: "v",
  course_count: 1,
  metrics: {
    mean_score: 80,
    blocked_share: 0,
    surface_coverage: 0.7,
    slope_coverage: 0.95,
    network_km: 100,
    area_km2: 12,
    poi_per_km2: { toilet: 2.5, elevator: 1, bench: 10, fountain: 1 },
    surface_mix: { smooth: 0.4, paving: 0.3, compacted: 0, cobble: 0, unpaved: 0, unknown: 0.3 },
  },
};
const INDEX: CityIndex = {
  generated_at: "x",
  weights_default: { slope: 1, surface: 0.8, kerb: 0.6, uncertainty: 0.3 },
  alpha: 3,
  cities: [CITY],
};

function route(len: number, steps: number, grade: number, score: number) {
  return {
    coords: [[2, 48], [2.01, 48.01]] as [number, number][],
    seg_ids: [],
    metrics: { length_m: len, steps_count: steps, max_grade_pct: grade, steep_m: 0, cobble_m: 0, mean_score: score, toilets_300m: 1 },
    profile: [[0, 10, 0], [25, 11, 4], [50, 13, 8], [75, 12, -2]] as [number, number | null, number | null][],
  };
}

function course(over: Partial<Course> = {}): Course {
  return {
    index: 0,
    name: "에펠 코스",
    time_label: "오전",
    stops: [
      { name: "출발", lon: 2, lat: 48 },
      { name: "도착", lon: 2.01, lat: 48.01 },
    ],
    field: null,
    reachable: true,
    blocked_at: null,
    snap_max_m: 5,
    approximate: false,
    routes: { shortest: route(1000, 10, 9, 60), accessible: route(1243, 0, 5, 85) },
    comparison: { extra_m: 243, steps_avoided: 10 },
    ...over,
  };
}

function makeCtx(): AppContext & { titles: unknown[][] } {
  document.body.innerHTML = '<div id="map"></div><div id="panel"></div>';
  const titles: unknown[][] = [];
  return {
    map: { fitTo: vi.fn(), isReady: () => true } as never,
    sheet: mountSheet(document.getElementById("panel")!),
    shell: {
      header: document.createElement("header"),
      pageHead: document.createElement("div"),
      setLayout: () => {},
      panel: document.getElementById("panel")!,
      mapContainer: document.getElementById("map")!,
      setTitle: (...args: unknown[]) => titles.push(args),
      onThemeChange: () => {},
    },
    index: INDEX,
    navigate: vi.fn(),
    signal: new AbortController().signal,
    titles,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPois).mockResolvedValue({ type: "FeatureCollection", features: [] });
  vi.mocked(loadSegments).mockResolvedValue({ type: "FeatureCollection", features: [] });
  vi.mocked(hasSegments).mockReturnValue(true);
});

describe("course view", () => {
  it("summary sentence for steps avoided", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    expect(ctx.sheet.el.querySelector(".course-summary")?.textContent).toBe("계단 10개를 피하는 대신 243m 더 가요");
    expect(ctx.titles[0]).toEqual(["에펠 코스", [{ label: "파리", href: "#/paris" }]]);
    expect(showRoutes).toHaveBeenCalled();
    expect(showStops).toHaveBeenCalled();
    expect(ctx.sheet.el.querySelector('a[href="#/paris/0/nav"]')).not.toBeNull();
    expect(ctx.sheet.el.querySelector(".metric-table")).not.toBeNull();
  });

  it("summary sentence without steps", async () => {
    vi.mocked(loadCourses).mockResolvedValue([
      course({ comparison: { extra_m: 20, steps_avoided: 0 } }),
      course({ index: 1, comparison: { extra_m: 120, steps_avoided: 0 } }),
    ]);
    const a = makeCtx();
    await courseView("paris", 0).mount(a);
    await tick();
    expect(a.sheet.el.querySelector(".course-summary")?.textContent).toBe("최단 경로와 거의 같은 길이에요");
    const b = makeCtx();
    await courseView("paris", 1).mount(b);
    await tick();
    expect(b.sheet.el.querySelector(".course-summary")?.textContent).toBe("경사와 노면을 고려해 120m 돌아가요");
  });

  it("approximate warning shown with snap distance", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course({ approximate: true, snap_max_m: 42 })]);
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    expect(ctx.sheet.el.textContent).toContain("위치 오차 있음 · 정류장이 실제 위치와 최대 42m 떨어져 있어요");
  });

  it("unreachable course shows message and no accessible column", async () => {
    vi.mocked(loadCourses).mockResolvedValue(unreachable as unknown as Course[]);
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    expect(ctx.sheet.el.textContent).toContain("휠체어로 이어지는 길을 찾지 못했어요");
    expect(ctx.sheet.el.textContent).not.toContain("접근성 경로");
    expect(ctx.sheet.el.querySelectorAll(".metric-table th[scope=col]").length).toBeLessThanOrEqual(2);
    expect(showBlockedAt).toHaveBeenCalledWith(ctx.map, [2.33, 48.86]);
  });

  it("highlights better accessible cells", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    const better = ctx.sheet.el.querySelectorAll(".metric-table td.better");
    expect(better.length).toBeGreaterThan(0);
    expect(better[0].textContent).toContain("더 나음");
  });

  it("field card only when field exists", async () => {
    vi.mocked(loadCourses).mockResolvedValue([
      course({ field: { difficulty: 3, stars: 4, note: "인도가 좁아요" } }),
    ]);
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    const card = ctx.sheet.el.querySelector(".field-card")!;
    expect(card.textContent).toContain("탐방팀 기록");
    expect(card.textContent).toContain("탐방팀 체감: 보통");
    expect(card.textContent).toContain("만족도 ★4/5");
    expect(card.textContent).toContain("인도가 좁아요");
  });

  it("course index out of range renders not-found", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    const ctx = makeCtx();
    await courseView("paris", 7).mount(ctx);
    expect(ctx.sheet.el.textContent).toContain("찾을 수 없어요");
  });

  it("counts nearby facilities from pois", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    vi.mocked(loadPois).mockResolvedValue({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [2.005, 48.005] }, properties: { kind: "toilet", name: null, wheelchair: null, osm_id: "1" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [2.0051, 48.0051] }, properties: { kind: "toilet", name: null, wheelchair: null, osm_id: "2" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [3, 49] }, properties: { kind: "bench", name: null, wheelchair: null, osm_id: "3" } },
      ],
    });
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    expect(ctx.sheet.el.querySelector(".poi-near")?.textContent).toContain("화장실 2곳");
    expect(ctx.sheet.el.querySelector(".poi-near")?.textContent).not.toContain("벤치 1곳");
  });

  it("unmount clears routes and stops", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    const ctx = makeCtx();
    const view = courseView("paris", 0);
    await view.mount(ctx);
    vi.mocked(showRoutes).mockClear();
    vi.mocked(showStops).mockClear();
    view.unmount();
    expect(showRoutes).toHaveBeenCalledWith(ctx.map, null, null);
    expect(showStops).toHaveBeenCalledWith(ctx.map, []);
    expect(showBlockedAt).toHaveBeenLastCalledWith(ctx.map, null);
  });

  it("ignores late data after abort", async () => {
    let resolve!: (c: Course[]) => void;
    vi.mocked(loadCourses).mockReturnValue(new Promise((r) => (resolve = r)));
    const ctx = makeCtx();
    const ctl = new AbortController();
    ctx.signal = ctl.signal;
    const view = courseView("paris", 0);
    const mounted = view.mount(ctx);
    ctl.abort();
    view.unmount();
    vi.mocked(showRoutes).mockClear();
    resolve([course()]);
    await mounted;
    expect(showRoutes).not.toHaveBeenCalled();
  });
});

describe("course view conditions panel", () => {
  it("the 내 조건 tab opens the panel inline; there is no separate button", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    vi.mocked(loadGraph).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    expect(ctx.sheet.el.textContent).not.toContain("내 조건으로 경로 바꾸기");
    expect(ctx.sheet.el.querySelector(".course-actions")).toBeNull();
    const panel = ctx.sheet.el.querySelector<HTMLElement>(".conditions")!;
    const tab = ctx.sheet.el.querySelector<HTMLButtonElement>('[role="radio"][data-value="custom"]')!;
    expect(tab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.hidden).toBe(true);
    tab.click();
    expect(panel.hidden).toBe(false);
    expect(panel.querySelectorAll('input[type="range"]').length).toBe(4);
    expect(panel.querySelectorAll('input[type="checkbox"]').length).toBe(4);
    const slope = panel.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slope.getAttribute("aria-valuetext")).toBe("보통");
    ctx.sheet.el.querySelector<HTMLButtonElement>('[role="radio"][data-value="accessible"]')!.click();
    expect(panel.hidden).toBe(true);
  });

  it("deep link loads the heatmap only when none is shown", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    vi.mocked(hasSegments).mockReturnValue(false);
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    expect(loadSegments).toHaveBeenCalledTimes(1);
    expect(showSegments).toHaveBeenCalledWith(ctx.map, expect.anything(), null);

    vi.mocked(loadSegments).mockClear();
    vi.mocked(hasSegments).mockReturnValue(true);
    await courseView("paris", 0).mount(makeCtx());
    await tick();
    expect(loadSegments).not.toHaveBeenCalled();
  });

  it("deep link shows the map loading overlay, with retry on failure", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    vi.mocked(hasSegments).mockReturnValue(false);
    vi.mocked(loadSegments)
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce({ type: "FeatureCollection", features: [] });
    const ctx = makeCtx();
    const view = courseView("paris", 0);
    await view.mount(ctx);
    await tick();
    const box = ctx.shell.mapContainer.querySelector<HTMLElement>(".map-overlay")!;
    expect(box.textContent).toContain("길 데이터를 불러오지 못했어요.");
    box.querySelector<HTMLButtonElement>("button")!.click();
    expect(box.textContent).not.toContain("못했어요");
    await tick();
    expect(showSegments).toHaveBeenCalledTimes(1);
    expect(ctx.shell.mapContainer.querySelector(".map-overlay")).toBeNull();
    view.unmount();
  });

  it("publishes the default route as current route on mount", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    const { currentRoute } = await import("../src/core/conditions");
    expect(currentRoute("paris", 0)?.source).toBe("default");
  });
});

describe("profileChart", () => {
  it("profileChart handles all-null elevations", () => {
    const node = profileChart([[0, null, null], [25, null, null]]);
    expect(node.textContent).toContain("고도 정보 없음");
    expect(node.querySelector("svg")).toBeNull();
    expect(profileChart([]).textContent).toContain("고도 정보 없음");
  });

  it("renders summary with max, min and steep section count", () => {
    const node = profileChart([
      [0, 10, 0],
      [25, 11, 7],
      [50, 13, 8],
      [75, 12, 1],
      [100, 12, 6.5],
    ]);
    expect(node.textContent).toContain("최고 13m · 최저 10m · 가파른 길(6% 이상) 2곳");
    expect(node.querySelector("svg")).not.toBeNull();
  });

  it("compare toggle flips aria-pressed", () => {
    const rows: [number, number | null, number | null][] = [[0, 1, 0], [25, 2, 3]];
    const node = profileChart(rows, { compare: rows });
    const btn = node.querySelector<HTMLButtonElement>("button")!;
    expect(btn.textContent).toBe("최단 경로도 보기");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("profileChart axis", () => {
  it("puts the distance unit in tick labels instead of an axis label", () => {
    const node = profileChart([[0, 1, 0], [500, 2, 3], [2500, 4, 2]]);
    expect(node.textContent).not.toContain("거리(m)");
  });
});

describe("course view route tabs and summary", () => {
  it("shows the route summary with a nav link on the sheet and on the map", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    const ctx = makeCtx();
    const view = courseView("paris", 0);
    await view.mount(ctx);
    await tick();
    const sheetLabels = [...ctx.sheet.el.querySelectorAll(".route-summary dt")].map((d) => d.textContent);
    expect(sheetLabels).toEqual(["거리", "추가 거리", "피한 계단", "최대 경사", "평균 점수"]);
    expect(ctx.sheet.el.querySelector(".route-summary")!.textContent).toContain("+243m");
    const bar = ctx.shell.mapContainer.querySelector(".route-bar")!;
    expect(bar.querySelector('a[href="#/paris/0/nav"]')).not.toBeNull();
    view.unmount();
    expect(ctx.shell.mapContainer.querySelector(".route-bar")).toBeNull();
    expect(setRouteFocus).toHaveBeenLastCalledWith(ctx.map, "accessible");
  });

  it("nav button label follows the tab: 최단 says 휠체어 경로로 길안내", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    vi.mocked(loadGraph).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    const root = ctx.sheet.el;
    const bar = ctx.shell.mapContainer.querySelector(".route-bar")!;
    const labels = () => [
      root.querySelector(".route-summary .route-nav")!.textContent,
      bar.querySelector(".route-nav")!.textContent,
    ];
    const tab = (v: string) => root.querySelector<HTMLButtonElement>('[role="radio"][data-value="' + v + '"]')!.click();
    expect(labels()).toEqual(["길안내", "길안내"]);
    tab("shortest");
    expect(labels()).toEqual(["휠체어 경로로 길안내", "휠체어 경로로 길안내"]);
    tab("custom");
    expect(labels()).toEqual(["길안내", "길안내"]);
    tab("shortest");
    tab("accessible");
    expect(labels()).toEqual(["길안내", "길안내"]);
  });

  it("segmented tabs switch the emphasised route and drive the conditions panel", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    vi.mocked(loadGraph).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    const group = ctx.sheet.el.querySelector<HTMLElement>('[role="radiogroup"]')!;
    const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(["최단", "휠체어", "내 조건"]);
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    const panel = ctx.sheet.el.querySelector<HTMLElement>(".conditions")!;

    radios[0].click();
    expect(setRouteFocus).toHaveBeenLastCalledWith(ctx.map, "shortest");
    expect(panel.hidden).toBe(true);

    radios[2].click();
    expect(setRouteFocus).toHaveBeenLastCalledWith(ctx.map, "accessible");
    expect(panel.hidden).toBe(false);
    expect(loadGraph).toHaveBeenCalledTimes(1);

    radios[1].click();
    expect(panel.hidden).toBe(true);
  });

  it("summary sentence, key-value list and map bar follow the selected tab", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    vi.mocked(loadGraph).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    const root = ctx.sheet.el;
    const bar = ctx.shell.mapContainer.querySelector(".route-bar")!;
    const pairs = (scope: Element) =>
      [...scope.querySelectorAll(".kv-row")].map((r) => [r.querySelector("dt")!.textContent, r.querySelector("dd")!.textContent]);
    const sentence = () => root.querySelector(".course-summary")!.textContent;
    const sheetKv = () => pairs(root.querySelector(".route-summary")!);
    const barKv = () => pairs(bar);
    const tab = (v: string) => root.querySelector<HTMLButtonElement>('[role="radio"][data-value="' + v + '"]')!.click();
    const table = root.querySelector<HTMLElement>(".metric-table:not(.diff-table)")!;
    const hint = root.querySelector<HTMLElement>(".route-hint")!;

    // 휠체어(기본)
    expect(sentence()).toBe("계단 10개를 피하는 대신 243m 더 가요");
    expect(barKv()[0]).toEqual(["거리", "1.2km"]);
    expect(hint.hidden).toBe(true);

    tab("shortest");
    expect(sentence()).toBe("가장 짧지만 지나갈 수 없는 계단 10개를 지나요");
    expect(sheetKv().map((r) => r[0])).toEqual(["거리", "지나갈 수 없는 계단", "최대 경사", "평균 점수"]);
    expect(sheetKv()[0][1]).toBe("1.0km");
    expect(sheetKv()[1][1]).toBe("10개");
    expect(barKv()).toEqual([["거리", "1.0km"], ["지나갈 수 없는 계단", "10개"], ["최대 경사", "9.0%"], ["평균 점수", "60"]]);
    expect(root.querySelectorAll(".route-summary .kv-row.is-strong").length).toBe(1);
    expect(table.hidden).toBe(false);

    // 내 조건, 아직 아무것도 바꾸지 않음: 기본 휠체어 경로 수치 + 안내
    tab("custom");
    expect(sentence()).toBe("계단 10개를 피하는 대신 243m 더 가요");
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe("아래에서 조건을 바꿔 보세요");
    expect(barKv()[0]).toEqual(["거리", "1.2km"]);
    // 최단 대비 표는 숨기고 기본 대비 차이 표만
    expect(table.hidden).toBe(true);

    tab("accessible");
    expect(sheetKv().map((r) => r[0])).toEqual(["거리", "추가 거리", "피한 계단", "최대 경사", "평균 점수"]);
    expect(table.hidden).toBe(false);
  });

  it("shortest tab says it is the shortest when there are no stairs", () => {
    const c = course({ routes: { shortest: route(1000, 0, 4, 70), accessible: route(1100, 0, 3, 80) } });
    expect(shortestSentence(c)).toBe("가장 짧은 길이에요");
    expect(shortestSentence(course())).toBe("가장 짧지만 지나갈 수 없는 계단 10개를 지나요");
  });

  it("custom sentence describes the difference from the default wheelchair route", () => {
    const base = { length_m: 1200, steps_count: 0, max_grade_pct: 5, steep_m: 0, cobble_m: 300, mean_score: 80, toilets_300m: 1 };
    expect(customSentence(base, { ...base, length_m: 1320, cobble_m: 260 })).toBe("기본 휠체어 경로보다 +120m · 돌길 −40m · 계단 0개");
    expect(customSentence(base, { ...base, length_m: 1150, steps_count: 1 })).toBe("기본 휠체어 경로보다 −50m · 돌길 0m · 계단 1개");
  });

  it("better mark compares displayed values: a tie after rounding gets no mark", async () => {
    const short = route(1000, 0, 5.04, 80.4);
    const acc = route(1000.3, 0, 5.01, 80.2);
    vi.mocked(loadCourses).mockResolvedValue([
      course({ routes: { shortest: short, accessible: acc }, comparison: { extra_m: 0, steps_avoided: 0 } }),
    ]);
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    // 1000m 대 1000m, 5.0% 대 5.0%, 80점 대 80점: 같아 보이므로 표시 없음
    expect(ctx.sheet.el.querySelectorAll(".metric-table td.better").length).toBe(0);
    expect(ctx.sheet.el.querySelector(".better-chip")).toBeNull();
    const m = (v: number | null) => `${Math.round(v!)}m`;
    expect(isBetter({ fmt: m, better: "low" }, 999.6, 1000.4)).toBe(false);
    expect(isBetter({ fmt: m, better: "low" }, 990, 1000)).toBe(true);
    expect(isBetter({ fmt: m, better: "high" }, 990, 1000)).toBe(false);
  });

  it("better cells carry a visible lime chip and keep the hidden text", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    const td = ctx.sheet.el.querySelector(".metric-table td.better")!;
    const chip = td.querySelector(".better-chip")!;
    expect(chip.textContent).toBe("✓ 더 나음");
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(td.querySelector(".visually-hidden")!.textContent).toBe(" 더 나음");
  });

  it("heatmap is dimmed on the course page and restored on leave", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course()]);
    const ctx = makeCtx();
    const view = courseView("paris", 0);
    await view.mount(ctx);
    await tick();
    expect(setSegmentsOpacity).toHaveBeenLastCalledWith(ctx.map, 0.35);
    view.unmount();
    expect(setSegmentsOpacity).toHaveBeenLastCalledWith(ctx.map, 1);
  });

  it("shows only facilities within 300 m of the selected route, recomputed on tab change", async () => {
    const shortest = { ...route(1000, 10, 9, 60), coords: [[2, 48], [2.01, 48]] as [number, number][] };
    const accessible = { ...route(1300, 0, 5, 85), coords: [[2, 48], [2, 48.01], [2.01, 48.01]] as [number, number][] };
    vi.mocked(loadCourses).mockResolvedValue([course({ routes: { shortest, accessible } })]);
    const poi = (id: string, kind: string, lon: number, lat: number) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [lon, lat] },
      properties: { kind, name: null, wheelchair: null, osm_id: id },
    });
    vi.mocked(loadPois).mockResolvedValue({
      type: "FeatureCollection",
      features: [
        poi("a", "toilet", 2.005, 48.0005), // 최단 경로 옆(약 55m)
        poi("b", "bench", 2.0002, 48.005), // 휠체어 경로 옆(약 15m)
        poi("c", "fountain", 2.5, 48.5), // 멀리
      ],
    } as never);
    const ctx = makeCtx();
    await courseView("paris", 0).mount(ctx);
    await tick();
    const shown = () =>
      (vi.mocked(showPois).mock.lastCall![1] as unknown as { features: { properties: { osm_id: string } }[] }).features.map(
        (f) => f.properties.osm_id,
      );
    expect(shown()).toEqual(["b"]);
    expect(ctx.sheet.el.querySelector(".poi-near")!.textContent).toBe("벤치 1곳");
    ctx.sheet.el.querySelector<HTMLButtonElement>('[role="radio"][data-value="shortest"]')!.click();
    expect(shown()).toEqual(["a"]);
    expect(ctx.sheet.el.querySelector(".poi-near")!.textContent).toBe("화장실 1곳");
  });

  it("unreachable course has no route tabs", async () => {
    vi.mocked(loadCourses).mockResolvedValue(unreachable as unknown as Course[]);
    const ctx = makeCtx();
    await courseView("paris", (unreachable as unknown as Course[])[0].index).mount(ctx);
    await tick();
    expect(ctx.sheet.el.querySelector('[role="radiogroup"]')).toBeNull();
  });
});
