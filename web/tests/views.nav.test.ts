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
  setSegmentsOpacity: vi.fn(),
  prefersReducedMotion: vi.fn(() => false),
}));

import { loadCourses, loadSegments } from "../src/data/load";
import { setSegmentsOpacity, showRouteProgress, showUser } from "../src/map/layers";
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

function makeCtx(): AppContext & { navigate: ReturnType<typeof vi.fn>; titles: unknown[][] } {
  document.body.innerHTML = '<div id="map"></div><div id="panel"></div>';
  const titles: unknown[][] = [];
  return {
    map: { map: { getZoom: () => 12, easeTo: vi.fn(), jumpTo: vi.fn() }, fitTo: vi.fn(), isReady: () => true } as never,
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
    expect(ctx.titles[0]).toEqual([
      "길안내",
      [
        { label: "파리", href: "#/paris" },
        { label: "호수 코스", href: "#/paris/0" },
      ],
      "호수 코스 길안내",
    ]);
    // 안내 카드는 지도 위에 떠 있고, 시트는 컨트롤 한 줄만 보이게 접힌다.
    const card = ctx.shell.mapContainer.querySelector(".nav-card")!;
    const ins = card.querySelector('[aria-live="polite"]')!;
    expect(ins.textContent).toMatch(/오른쪽/);
    expect(card.querySelector('[aria-live="assertive"]')).not.toBeNull();
    expect(ctx.sheet.snap()).toBe("peek");
    expect(ctx.sheet.peekHeight()).toBeGreaterThan(132);
    vi.advanceTimersByTime(2000);
    expect(showUser).toHaveBeenCalled();
    expect(showRouteProgress).toHaveBeenCalled();
    expect(setSegmentsOpacity).toHaveBeenCalledWith(expect.anything(), 0.35);
    expect(card.textContent).toContain("남은 거리");
    const controls = ctx.sheet.el.querySelector(".nav-controls")!;
    const sim = [...controls.querySelectorAll("button")].find((b) => b.textContent === "가상 위치");
    expect(sim?.getAttribute("aria-pressed")).toBe("true");
    const speed = controls.querySelector<HTMLButtonElement>(".nav-speed")!;
    expect(speed.textContent).toBe("1×");
    speed.click();
    expect(speed.textContent).toBe("4×");
    v.unmount();
    expect(ctx.shell.mapContainer.querySelector(".nav-card")).toBeNull();
  });

  it("geolocation denied replaces the checking text at once; the single source toggle starts simulation", async () => {
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
    const card = ctx.shell.mapContainer.querySelector(".nav-card")!;
    const ins = card.querySelector(".nav-instruction")!;
    expect(ins.textContent).toBe("위치를 확인하는 중");
    fail({ code: 1, message: "" } as GeolocationPositionError);
    expect(ins.textContent).toBe("위치를 쓸 수 없어요 — 가상 위치로 볼 수 있어요");
    expect(card.textContent).toContain("유럽에 있지 않아도 길안내를 볼 수 있어요");
    // 따로 "가상 위치로 보기" 버튼은 없다. 토글 하나뿐이다.
    const all = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(all).not.toContain("가상 위치로 보기");
    expect(all.filter((t) => t === "가상 위치").length).toBe(1);
    const sim = [...ctx.sheet.el.querySelectorAll<HTMLButtonElement>(".nav-controls button")].find((b) => b.textContent === "가상 위치")!;
    sim.click();
    expect(card.textContent).not.toContain("유럽에 있지 않아도");
    vi.advanceTimersByTime(1000);
    expect(showUser).toHaveBeenCalled();
    expect(ins.textContent).not.toBe("위치를 쓸 수 없어요 — 가상 위치로 볼 수 있어요");
    v.unmount();
  });

  it("unavailable position gets the same immediate copy", async () => {
    let fail: PositionErrorCallback = () => {};
    setGeo({ watchPosition: (_ok: PositionCallback, e: PositionErrorCallback) => ((fail = e), 1), clearWatch: vi.fn() });
    const ctx = makeCtx();
    const v = navView("paris", 0);
    await v.mount(ctx);
    await flush();
    fail({ code: 2, message: "" } as GeolocationPositionError);
    const card = ctx.shell.mapContainer.querySelector(".nav-card")!;
    expect(card.querySelector(".nav-instruction")!.textContent).toBe("위치를 쓸 수 없어요 — 가상 위치로 볼 수 있어요");
    expect(card.textContent).toContain("현재 위치를 가져오지 못했어요");
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
    const warn0 = ctx.shell.mapContainer.querySelector<HTMLElement>('[aria-live="assertive"]')!;
    far(200); // 정확도가 나쁘면 벗어난 것으로 보지 않는다
    far(200);
    expect(warn0.hidden).toBe(true);
    far(5);
    expect(warn0.hidden).toBe(true); // 한 번만으로는 경고하지 않는다
    far(5);
    const warn = ctx.shell.mapContainer.querySelector<HTMLElement>('[aria-live="assertive"]')!;
    expect(warn.hidden).toBe(false);
    expect(warn.textContent).toMatch(/^경로에서 \d+m 벗어났어요$/);
    v.unmount();
  });

  it("a far first gps fix suggests the simulated position without starting it or moving the camera", async () => {
    let ok: PositionCallback = () => {};
    const clearWatch = vi.fn();
    setGeo({ watchPosition: (s: PositionCallback) => ((ok = s), 1), clearWatch });
    const ctx = makeCtx();
    const v = navView("paris", 0);
    await v.mount(ctx);
    await flush();
    const m = (ctx.map as unknown as { map: { easeTo: ReturnType<typeof vi.fn>; jumpTo: ReturnType<typeof vi.fn> } }).map;
    ok({ coords: { longitude: 2.35, latitude: 48.85, heading: null, accuracy: 10 } } as GeolocationPosition);
    const card = ctx.shell.mapContainer.querySelector(".nav-card")!;
    expect(card.querySelector(".nav-instruction")!.textContent).toBe("지금 이 도시에 있지 않아요 — 가상 위치로 볼 수 있어요");
    expect(m.easeTo).not.toHaveBeenCalled();
    expect(m.jumpTo).not.toHaveBeenCalled();
    expect(showUser).not.toHaveBeenCalled();
    const pressed = [...ctx.sheet.el.querySelectorAll<HTMLButtonElement>(".nav-controls button")].map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
    expect(pressed).toContainEqual(["가상 위치", "false"]); // 자동으로 시작하지 않는다
    v.unmount();
  });

  it("does not follow positions over 1 km off the route and formats the distance with km", async () => {
    let ok: PositionCallback = () => {};
    setGeo({ watchPosition: (s: PositionCallback) => ((ok = s), 1), clearWatch: vi.fn() });
    const ctx = makeCtx();
    const v = navView("paris", 0);
    await v.mount(ctx);
    await flush();
    const m = (ctx.map as unknown as { map: { easeTo: ReturnType<typeof vi.fn>; jumpTo: ReturnType<typeof vi.fn> } }).map;
    ok({ coords: { longitude: 8.3, latitude: 47.0003, heading: null, accuracy: 5 } } as GeolocationPosition);
    expect(m.easeTo).toHaveBeenCalledTimes(1);
    const far = () => ok({ coords: { longitude: 8.3, latitude: 47.001 + 0.0108, heading: null, accuracy: 5 } } as GeolocationPosition);
    far();
    far();
    far();
    expect(m.easeTo).toHaveBeenCalledTimes(1);
    const warn = ctx.shell.mapContainer.querySelector<HTMLElement>('[aria-live="assertive"]')!;
    expect(warn.hidden).toBe(false);
    expect(warn.textContent).toMatch(/^경로에서 1\.\dkm 벗어났어요$/);
    v.unmount();
  });

  it("an unreachable course shows the explanation instead of guiding", async () => {
    const c = course();
    vi.mocked(loadCourses).mockResolvedValue([{ ...c, reachable: false, routes: { shortest: c.routes.shortest, accessible: null }, blocked_at: [8.3, 47.0005] }]);
    setGeo(undefined);
    const ctx = makeCtx();
    const v = navView("paris", 0);
    await v.mount(ctx);
    await flush();
    vi.advanceTimersByTime(3000);
    expect(ctx.sheet.el.textContent).toContain("휠체어로 이어지는 길이 없어 길안내를 할 수 없어요");
    expect(ctx.shell.mapContainer.querySelector(".nav-card")).toBeNull();
    expect(showUser).not.toHaveBeenCalled();
    expect(loadSegments).not.toHaveBeenCalled();
    expect([...ctx.sheet.el.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain("#/paris/0");
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
