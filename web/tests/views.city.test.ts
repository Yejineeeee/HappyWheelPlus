import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { HOME_PEEK, homeStats, homeView } from "../src/views/home";
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

function makeCtx(): AppContext & { titles: unknown[][] } {
  document.body.innerHTML = '<div id="map"></div><div id="panel"></div>';
  const titles: unknown[][] = [];
  const mapContainer = document.getElementById("map")!;
  return {
    map: { fitTo: vi.fn(), isReady: () => true } as never,
    sheet: mountSheet(document.getElementById("panel")!),
    shell: {
      header: document.createElement("header"),
      pageHead: document.createElement("div"),
      setLayout: () => {},
      panel: document.getElementById("panel")!,
      mapContainer,
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
    const overlay = document.querySelector(".map-overlay")!;
    expect(overlay.textContent).toBe("파리 길 데이터를 불러오는 중…");
    expect(overlay.getAttribute("role")).toBe("status");
    expect(overlay.querySelector(".progress-bar")).not.toBeNull();
    expect(ctx.titles[0]).toEqual(["파리", [{ label: "홈", href: "#/" }]]);
    expect(ctx.sheet.el.textContent).toContain("평균 점수");
  });

  it("unknown city renders not-found", async () => {
    const ctx = makeCtx();
    await cityView("seoul").mount(ctx);
    expect(ctx.sheet.el.textContent).toContain("찾을 수 없어요");
    expect(ctx.sheet.el.querySelector('a[href="#/"]')).not.toBeNull();
    expect(ctx.titles[0]).toEqual(["찾을 수 없어요", [{ label: "홈", href: "#/" }]]);
    expect(loadCourses).not.toHaveBeenCalled();
  });

  it("cards show computed results only; field records stay on the course page", async () => {
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
    expect(cards[0].textContent).not.toMatch(/난이도|탐방팀|★|만족도/);
    expect(cards[1].textContent).not.toMatch(/난이도|탐방팀|★|만족도/);
    expect(cards[2].textContent).toContain("경로 없음");
    expect(cards[2].textContent).toContain("위치 오차 있음");
  });

  it("retries only segments after a failure", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course(0)]);
    vi.mocked(loadSegments)
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce({ type: "FeatureCollection", features: [] });
    const ctx = makeCtx();
    await cityView("paris").mount(ctx);
    await tick();
    // 실패는 지도 위 같은 알림 자리에서 보이고, 거기서 다시 시도한다.
    const box = ctx.shell.mapContainer.querySelector<HTMLElement>(".map-overlay")!;
    expect(box.textContent).toContain("길 데이터를 불러오지 못했어요.");
    const retry = box.querySelector<HTMLButtonElement>("button")!;
    expect(retry.textContent).toBe("다시 시도");
    retry.click();
    expect(box.textContent).not.toContain("불러오지 못했어요");
    await tick();
    expect(showSegments).toHaveBeenCalledTimes(1);
    expect(loadCourses).toHaveBeenCalledTimes(1);
    expect(ctx.shell.mapContainer.querySelector(".map-overlay")).toBeNull();
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

  it("card has an accessible label for the score", async () => {
    vi.mocked(loadCourses).mockResolvedValue([course(0, { field: { difficulty: 2, stars: 5, note: "" } })]);
    vi.mocked(loadSegments).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await cityView("paris").mount(ctx);
    const text = ctx.sheet.el.querySelector(".course-card")!.textContent!;
    expect(text).toContain("점수 77");
    expect(text).toContain("보통");
    expect(text).not.toContain("별점");
  });
});

describe("city view on narrow and wide screens", () => {
  const orig = window.matchMedia;
  afterEach(() => {
    window.matchMedia = orig;
  });
  const stubWide = (wide: boolean) => {
    window.matchMedia = ((q: string) => ({
      matches: wide && q.includes("min-width: 1024px"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  };

  it("narrow: course cards come first, metrics/legend/facility chips sit in a collapsed disclosure", async () => {
    stubWide(false);
    vi.mocked(loadCourses).mockResolvedValue([course(0), course(1)]);
    vi.mocked(loadSegments).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await cityView("paris").mount(ctx);
    await tick();
    const city = ctx.sheet.el.querySelector(".city")!;
    // 첫 제목은 코스, 카드가 접기 영역보다 앞
    expect(city.querySelector(".section-title")!.textContent).toBe("코스 2개");
    const btn = city.querySelector<HTMLButtonElement>(".disclosure-btn")!;
    expect(btn.textContent).toBe("지도 보기 설정");
    const body = city.querySelector<HTMLElement>(".disclosure-body")!;
    expect(btn.compareDocumentPosition(city.querySelector(".course-card")!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-controls")).toBe(body.id);
    expect(body.hidden).toBe(true);
    expect(body.querySelector(".city-metrics")).not.toBeNull();
    expect(body.querySelector(".legend")).not.toBeNull();
    expect(body.querySelectorAll(".chip").length).toBe(4);
    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(body.hidden).toBe(false);
    btn.click();
    expect(body.hidden).toBe(true);
  });

  it("wide: metrics stay open above the course list with no disclosure", async () => {
    stubWide(true);
    vi.mocked(loadCourses).mockResolvedValue([course(0)]);
    vi.mocked(loadSegments).mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx();
    await cityView("paris").mount(ctx);
    await tick();
    const city = ctx.sheet.el.querySelector(".city")!;
    expect(city.querySelector(".disclosure")).toBeNull();
    expect(city.firstElementChild!.classList.contains("city-metrics")).toBe(true);
  });
});

describe("home sheet height", () => {
  it("starts collapsed at 220px so one city card shows under the intro", async () => {
    const ctx = makeCtx();
    ctx.sheet.setSnap("half");
    await homeView().mount(ctx);
    expect(ctx.sheet.peekHeight()).toBe(HOME_PEEK);
    expect(HOME_PEEK).toBe(220);
    expect(ctx.sheet.snap()).toBe("peek");
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
    expect(showCityMarkers).toHaveBeenCalledTimes(1);
    expect(ctx.titles[0]).toEqual([null]);
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
    expect(s).toMatchObject({ countries: 2, cities: 2, courses: 3, meanScore: 85 });
    expect(s.networkKm).toBeCloseTo(800.6, 6);
    expect(homeStats([]).meanScore).toBeNull();

    const ctx = makeCtx();
    await homeView().mount(ctx);
    const intro = ctx.sheet.el.querySelector(".intro")!;
    expect(intro.textContent).toBe("2개국 3개 도시, 길 300km를 구간마다 채점했어요. 탐방 코스 4개를 최단 경로와 비교해요.");
    expect(intro.querySelectorAll(".num").length).toBe(3);
    expect(ctx.sheet.el.querySelector(".stats, .stat")).toBeNull();
    const thumb = ctx.sheet.el.querySelector<HTMLImageElement>(".city-row img")!;
    expect(thumb.getAttribute("src")).toMatch(/data\/[a-z]+\/thumb\.webp\?v=v$/);
    expect(thumb.getAttribute("alt")).toBe("");
    expect(loadCourses).not.toHaveBeenCalled();
  });
});
