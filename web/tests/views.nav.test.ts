import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CityEntry, CityIndex, Course } from "../src/data/types";

vi.mock("../src/data/load", () => ({
  loadCourses: vi.fn(),
  loadSegments: vi.fn(),
}));
vi.mock("../src/map/layers", () => ({
  showRoutes: vi.fn(),
  showRouteProgress: vi.fn(),
  showStops: vi.fn(),
  showUser: vi.fn(),
  prefersReducedMotion: vi.fn(() => false),
}));

import { loadCourses, loadSegments } from "../src/data/load";
import { showRouteProgress, showUser } from "../src/map/layers";
import { mountSheet } from "../src/ui/sheet";
import { navView, segmentSpans } from "../src/views/nav";
import type { AppContext } from "../src/views/types";

const CITY = {
  id: "paris", name_ko: "파리", country_ko: "프랑스", center: [8.3, 47], radius_m: 2000,
  data_version: "v", course_count: 1, metrics: {},
} as unknown as CityEntry;
const INDEX: CityIndex = {
  generated_at: "x",
  weights_default: { slope: 1, surface: 0.8, kerb: 0.6, uncertainty: 0.3 },
  alpha: 3,
  cities: [CITY],
};

const COORDS: [number, number][] = [[8.3, 47.0], [8.3, 47.001], [8.3012, 47.001]];

function course(): Course {
  const r = {
    coords: COORDS,
    seg_ids: [0, 1],
    metrics: { length_m: 193, steps_count: 0, max_grade_pct: 2, steep_m: 0, cobble_m: 0, mean_score: 80, toilets_300m: 0 },
    profile: [],
  };
  return {
    index: 0, name: "호수 코스", time_label: "", field: null, reachable: true, blocked_at: null, snap_max_m: 0,
    approximate: false, comparison: null, routes: { shortest: r, accessible: r },
    stops: [
      { name: "출발", lon: 8.3, lat: 47.0 },
      { name: "호수", lon: 8.3012, lat: 47.001 },
    ],
  };
}

const prop = { len: 100, p_slope: 0, p_surface: 0, p_kerb: 0, p_unc: 0, grade_max: 1, surface_class: "smooth", wc_yes: false, steps: false, blocked: false, span: false, score: 90 };
// 두 번째 구간은 v→u 방향으로 저장돼 있다
const SEGS = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: prop, geometry: { type: "LineString", coordinates: [COORDS[0], COORDS[1]] } },
    { type: "Feature", properties: { ...prop, grade_max: 8 }, geometry: { type: "LineString", coordinates: [COORDS[2], COORDS[1]] } },
  ],
};

function makeCtx(): AppContext & { navigate: ReturnType<typeof vi.fn>; titles: [string, string | undefined][] } {
  document.body.innerHTML = '<div id="map"></div><div id="panel"></div>';
  const titles: [string, string | undefined][] = [];
  return {
    map: { map: { getZoom: () => 12, easeTo: vi.fn(), jumpTo: vi.fn() }, fitTo: vi.fn(), isReady: () => true } as never,
    sheet: mountSheet(document.getElementById("panel")!),
    shell: {
      header: document.createElement("header"),
      panel: document.getElementById("panel")!,
      mapContainer: document.getElementById("map")!,
      setTitle: (t: string, b?: string) => titles.push([t, b]),
      onThemeChange: () => {},
    },
    index: INDEX,
    navigate: vi.fn(),
    signal: new AbortController().signal,
    titles,
  } as never;
}

function setGeo(v: unknown): void {
  Object.defineProperty(navigator, "geolocation", { value: v, configurable: true });
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(loadCourses).mockResolvedValue([course()]);
  vi.mocked(loadSegments).mockResolvedValue(SEGS as never);
});
afterEach(() => {
  vi.useRealTimers();
  setGeo(undefined);
});

describe("segmentSpans", () => {
  it("orients segments along the route and fits them to its length", () => {
    const spans = segmentSpans(COORDS, [0, 1], SEGS.features as never);
    expect(spans).toHaveLength(2);
    expect(spans[0].startM).toBe(0);
    expect(spans[1].startM).toBeCloseTo(spans[0].endM, 3);
    expect(spans[1].props.grade_max).toBe(8);
    expect(spans[1].endM).toBeCloseTo(111.2 + 91.1, -1);
  });
});

describe("nav view", () => {
  it("without geolocation starts simulation and shows live instruction", async () => {
    setGeo(undefined);
    const ctx = makeCtx();
    const v = navView("paris", 0);
    await v.mount(ctx);
    await flush();
    expect(ctx.titles[0]).toEqual(["호수 코스 길안내", "#/paris/0"]);
    const ins = ctx.sheet.el.querySelector('[aria-live="polite"]')!;
    expect(ins.textContent).toMatch(/오른쪽/);
    expect(ctx.sheet.el.querySelector('[aria-live="assertive"]')).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(showUser).toHaveBeenCalled();
    expect(showRouteProgress).toHaveBeenCalled();
    expect(ctx.sheet.el.textContent).toContain("남은 거리");
    const sim = [...ctx.sheet.el.querySelectorAll("button")].find((b) => b.textContent === "가상 위치");
    expect(sim?.getAttribute("aria-pressed")).toBe("true");
    v.unmount();
  });

  it("geolocation denied shows the simulation prompt and the button starts simulation", async () => {
    let fail: PositionErrorCallback = () => {};
    setGeo({
      watchPosition: (_ok: PositionCallback, e: PositionErrorCallback) => {
        fail = e;
        return 1;
      },
      clearWatch: vi.fn(),
    });
    const ctx = makeCtx();
    const v = navView("paris", 0);
    await v.mount(ctx);
    await flush();
    fail({ code: 1, message: "" } as GeolocationPositionError);
    expect(ctx.sheet.el.textContent).toContain("유럽에 있지 않아도 가상 위치로 길안내를 볼 수 있어요");
    const btn = [...ctx.sheet.el.querySelectorAll("button")].find((b) => b.textContent === "가상 위치로 보기")!;
    btn.click();
    expect(ctx.sheet.el.textContent).not.toContain("유럽에 있지 않아도");
    vi.advanceTimersByTime(1000);
    expect(showUser).toHaveBeenCalled();
    v.unmount();
  });

  it("shows the off-route warning for a far gps fix", async () => {
    let ok: PositionCallback = () => {};
    setGeo({ watchPosition: (s: PositionCallback) => ((ok = s), 1), clearWatch: vi.fn() });
    const ctx = makeCtx();
    const v = navView("paris", 0);
    await v.mount(ctx);
    await flush();
    const far = (accuracy: number) =>
      ok({ coords: { longitude: 8.3 + 0.002, latitude: 47.0003, heading: null, accuracy } } as GeolocationPosition);
    const warn0 = ctx.sheet.el.querySelector<HTMLElement>('[aria-live="assertive"]')!;
    far(200); // 정확도가 나쁘면 벗어난 것으로 보지 않는다
    far(200);
    expect(warn0.hidden).toBe(true);
    far(5);
    expect(warn0.hidden).toBe(true); // 한 번만으로는 경고하지 않는다
    far(5);
    const warn = ctx.sheet.el.querySelector<HTMLElement>('[aria-live="assertive"]')!;
    expect(warn.hidden).toBe(false);
    expect(warn.textContent).toMatch(/^경로에서 \d+m 벗어났어요$/);
    v.unmount();
  });

  it("end button goes back to the course", async () => {
    const ctx = makeCtx();
    const v = navView("paris", 0);
    await v.mount(ctx);
    await flush();
    [...ctx.sheet.el.querySelectorAll("a")].find((a) => a.textContent === "길안내 끝내기")!.click();
    expect(ctx.navigate).toHaveBeenCalledWith({ name: "course", city: "paris", course: 0 });
    v.unmount();
  });

  it("unmount stops simulation and geolocation watch", async () => {
    const clearWatch = vi.fn();
    setGeo({ watchPosition: () => 3, clearWatch });
    const ctx = makeCtx();
    const gps = navView("paris", 0);
    await gps.mount(ctx);
    await flush();
    gps.unmount();
    expect(clearWatch).toHaveBeenCalledWith(3);

    setGeo(undefined);
    const ctx2 = makeCtx();
    const sim = navView("paris", 0);
    await sim.mount(ctx2);
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    sim.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(showUser).toHaveBeenLastCalledWith(ctx2.map, null);
  });
});
