import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CityEntry, CityIndex, Course } from "../src/data/types";

vi.mock("../src/data/load", () => ({
  loadCourses: vi.fn(),
  loadSegments: vi.fn(),
  loadPois: vi.fn(),
}));
vi.mock("../src/map/layers", () => ({
  showCityMarkers: vi.fn(),
  showSegments: vi.fn(),
  showPois: vi.fn(),
  clearCityLayers: vi.fn(),
}));

import { loadCourses, loadPois, loadSegments } from "../src/data/load";
import { showCityMarkers, showPois, showSegments } from "../src/map/layers";
import { mountSheet } from "../src/ui/sheet";
import { cityView } from "../src/views/city";
import { homeStats, homeView } from "../src/views/home";
import type { AppContext } from "../src/views/types";

function city(id: string, name: string, country: string, score: number, n: number): CityEntry {
  return {
    id,
    name_ko: name,
    country_ko: country,
    center: [2, 48],
    radius_m: 2000,
    data_version: "v",
    course_count: n,
    metrics: {
      mean_score: score,
      blocked_share: 0,
      surface_coverage: 0.7,
      slope_coverage: 0.95,
      network_km: 100,
      area_km2: 12,
      poi_per_km2: { toilet: 2.5, elevator: 1, bench: 10, fountain: 1 },
      surface_mix: { smooth: 0.4, paving: 0.3, compacted: 0, cobble: 0, unpaved: 0, unknown: 0.3 },
    },
  };
}

const INDEX: CityIndex = {
  generated_at: "x",
  weights_default: { slope: 1, surface: 0.8, kerb: 0.6, uncertainty: 0.3 },
  alpha: 3,
  cities: [
    city("paris", "파리", "프랑스", 80, 2),
    city("london", "런던", "영국", 91, 1),
    city("lyon", "리옹", "프랑스", 70, 1),
  ],
};

function route(len: number) {
  return {
    coords: [[2, 48], [2.01, 48.01]] as [number, number][],
    seg_ids: [],
    metrics: { length_m: len, steps_count: 0, max_grade_pct: 4.2, steep_m: 0, cobble_m: 0, mean_score: 77.4, toilets_300m: 1 },
    profile: [],
  };
}

function course(i: number, over: Partial<Course> = {}): Course {
  return {
    index: i,
    name: `코스${i}`,
    time_label: "오전",
    stops: [],
    field: null,
    reachable: true,
    blocked_at: null,
    snap_max_m: 5,
    approximate: false,
    routes: { shortest: route(1000), accessible: route(1200) },
    comparison: { extra_m: 200, steps_avoided: 0 },
    ...over,
  };
}

function makeCtx(): AppContext & { titles: [string, string | undefined][] } {
  document.body.innerHTML = '<div id="map"></div><div id="panel"></div>';
  const titles: [string, string | undefined][] = [];
  const mapContainer = document.getElementById("map")!;
  return {
    map: { fitTo: vi.fn(), isReady: () => true } as never,
    sheet: mountSheet(document.getElementById("panel")!),
    shell: {
      header: document.createElement("header"),
      panel: document.getElementById("panel")!,
      mapContainer,
      setTitle: (t: string, b?: string) => titles.push([t, b]),
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
});

describe("city view", () => {
  it("city view renders course cards before segments resolve", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course(0), course(1), course(2)]);
    vi.mocked(loadSegments).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await cityView("paris").mount(ctx);
    await tick();
    expect(ctx.sheet.el.querySelectorAll(".course-card").length).toBe(3);
    expect(showSegments).not.toHaveBeenCalled();
    expect(document.querySelector(".map-overlay")?.textContent).toContain("길 데이터를 불러오는 중");
    expect(ctx.titles[0]).toEqual(["파리", "#/"]);
    expect(ctx.sheet.el.textContent).toContain("평균 점수");
  });

  it("unknown city renders not-found", async () => {
    const ctx = makeCtx();
    await cityView("seoul").mount(ctx);
    expect(ctx.sheet.el.textContent).toContain("찾을 수 없어요");
    expect(ctx.sheet.el.querySelector('a[href="#/"]')).not.toBeNull();
    expect(ctx.titles[0]).toEqual(["찾을 수 없어요", "#/"]);
    expect(loadCourses).not.toHaveBeenCalled();
  });

  it("field badge only when field exists", async () => {
    vi.mocked(loadCourses).mockResolvedValue([
      course(0, { field: { difficulty: 2, stars: 5, note: "" } }),
      course(1),
      course(2, { approximate: true, routes: { shortest: route(900), accessible: null }, comparison: null }),
    ]);
    vi.mocked(loadSegments).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await cityView("paris").mount(ctx);
    await tick();
    const cards = ctx.sheet.el.querySelectorAll(".course-card");
    expect(cards[0].textContent).toContain("현장 난이도 2/5 · ★5");
    expect(cards[1].textContent).not.toContain("현장 난이도");
    expect(cards[2].textContent).toContain("경로 없음");
    expect(cards[2].textContent).toContain("근사 결과");
  });

  it("retries only segments after a failure", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course(0)]);
    vi.mocked(loadSegments)
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce({ type: "FeatureCollection", features: [] });
    const ctx = makeCtx();
    await cityView("paris").mount(ctx);
    await tick();
    const retry = ctx.sheet.el.querySelector<HTMLButtonElement>(".block-error button")!;
    expect(retry).not.toBeNull();
    retry.click();
    await tick();
    expect(showSegments).toHaveBeenCalledTimes(1);
    expect(loadCourses).toHaveBeenCalledTimes(1);
    expect(ctx.sheet.el.querySelector(".block-error")).toBeNull();
  });
});

describe("city view lifecycle", () => {
  it("ignores late data after the signal is aborted", async () => {
    let resolveCourses!: (c: Course[]) => void;
    let resolveSeg!: (v: never) => void;
    let resolvePois!: (v: never) => void;
    vi.mocked(loadCourses).mockReturnValue(new Promise((r) => (resolveCourses = r)));
    vi.mocked(loadSegments).mockReturnValue(new Promise((r) => (resolveSeg = r as never)));
    vi.mocked(loadPois).mockReturnValue(new Promise((r) => (resolvePois = r as never)));
    const ctx = makeCtx();
    const ctl = new AbortController();
    ctx.signal = ctl.signal;
    const setContent = vi.spyOn(ctx.sheet, "setContent");
    const view = cityView("paris");
    const mounted = view.mount(ctx);
    ctl.abort();
    view.unmount();
    setContent.mockClear();
    resolveCourses([course(0)]);
    await mounted;
    resolveSeg({ type: "FeatureCollection", features: [] } as never);
    resolvePois({ type: "FeatureCollection", features: [] } as never);
    await tick();
    expect(setContent).not.toHaveBeenCalled();
    expect(showSegments).not.toHaveBeenCalled();
    expect(showPois).not.toHaveBeenCalled();
  });

  it("aborts segment and poi results that arrive after courses", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course(0)]);
    let resolveSeg!: (v: never) => void;
    let resolvePois!: (v: never) => void;
    vi.mocked(loadSegments).mockReturnValue(new Promise((r) => (resolveSeg = r as never)));
    vi.mocked(loadPois).mockReturnValue(new Promise((r) => (resolvePois = r as never)));
    const ctx = makeCtx();
    const ctl = new AbortController();
    ctx.signal = ctl.signal;
    const view = cityView("paris");
    await view.mount(ctx);
    ctl.abort();
    view.unmount();
    resolveSeg({ type: "FeatureCollection", features: [] } as never);
    resolvePois({ type: "FeatureCollection", features: [] } as never);
    await tick();
    expect(showSegments).not.toHaveBeenCalled();
    expect(showPois).not.toHaveBeenCalled();
  });

  it("chip toggle passes updated visibility to showPois; benches start off", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course(0)]);
    vi.mocked(loadSegments).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await cityView("paris").mount(ctx);
    await tick();
    expect(showPois).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showPois).mock.calls[0][2]).toMatchObject({ toilet: true, bench: false });
    const chips = [...ctx.sheet.el.querySelectorAll<HTMLButtonElement>(".chip")];
    expect(chips[2].getAttribute("aria-pressed")).toBe("false");
    chips[2].click();
    chips[0].click();
    expect(showPois).toHaveBeenCalledTimes(3);
    expect(vi.mocked(showPois).mock.calls[2][2]).toMatchObject({ toilet: false, bench: true });
    expect(chips[0].getAttribute("aria-pressed")).toBe("false");
  });

  it("card has accessible labels for score and field stars", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course(0, { field: { difficulty: 2, stars: 5, note: "" } })]);
    vi.mocked(loadSegments).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await cityView("paris").mount(ctx);
    const text = ctx.sheet.el.querySelector(".course-card")!.textContent!;
    expect(text).toContain("접근성 점수 77점");
    expect(text).toContain("현장 별점 5");
  });
});

describe("home view", () => {
  it("home lists all cities grouped by country", async () => {
    const ctx = makeCtx();
    await homeView().mount(ctx);
    const groups = [...ctx.sheet.el.querySelectorAll(".country-group")];
    expect(groups.map((g) => g.querySelector("h3")!.textContent)).toEqual(["프랑스", "영국"]);
    expect(groups[0].querySelectorAll(".city-row").length).toBe(2);
    expect(groups[1].querySelectorAll(".city-row").length).toBe(1);
    expect(ctx.sheet.el.querySelector('a[href="#/compare"]')).not.toBeNull();
    expect(ctx.sheet.el.querySelector('a[href="#/about"]')).not.toBeNull();
    expect(showCityMarkers).toHaveBeenCalledTimes(1);
    expect(ctx.titles[0]).toEqual(["HappyWheel+", undefined]);
    groups[1].querySelector<HTMLButtonElement>(".city-row")!.click();
    expect(ctx.navigate).toHaveBeenCalledWith({ name: "city", city: "london" });
  });
});

describe("home summary", () => {
  it("computes the headline numbers from cities.json only", async () => {
    const a = city("paris", "파리", "프랑스", 80, 2);
    const b = city("london", "런던", "영국", 90, 1);
    a.metrics.network_km = 500.4;
    b.metrics.network_km = 300.2;
    const s = homeStats([a, b]);
    expect(s).toMatchObject({ cities: 2, courses: 3, meanScore: 85 });
    expect(s.networkKm).toBeCloseTo(800.6, 6);
    expect(homeStats([]).meanScore).toBeNull();

    const ctx = makeCtx();
    await homeView().mount(ctx);
    const labels = [...ctx.sheet.el.querySelectorAll(".stats-summary dt")].map((d) => d.textContent);
    expect(labels).toEqual(["도시", "코스", "분석한 길", "평균 점수"]);
    const thumb = ctx.sheet.el.querySelector<HTMLImageElement>(".city-row img")!;
    expect(thumb.getAttribute("src")).toMatch(/data\/[a-z]+\/thumb\.webp\?v=v$/);
    expect(thumb.getAttribute("alt")).toBe("");
    expect(loadCourses).not.toHaveBeenCalled();
  });
});
