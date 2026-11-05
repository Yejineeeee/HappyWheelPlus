import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CityEntry, CityIndex, Course } from "../src/data/types";

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
  showSegments: vi.fn(),
  hasSegments: vi.fn(() => true),
}));

import { currentRoute } from "../src/core/conditions";
import { loadCourses, loadGraph, loadPois, loadSegments } from "../src/data/load";
import { showRoutes, showSegments } from "../src/map/layers";
import { mountSheet } from "../src/ui/sheet";
import { courseView, } from "../src/views/course";
import { diffTable, missingMessage } from "../src/views/conditions";
import type { AppContext } from "../src/views/types";

const dir = resolve(__dirname, "../public/data");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (p: string): any => JSON.parse(readFileSync(resolve(dir, p), "utf8"));

const idx: CityIndex = read("cities.json");
const CITY: CityEntry = idx.cities.find((c) => c.id === "lucerne")!;
const graphJson = read("lucerne/graph.json");
const segs = read("lucerne/segments.geojson");
const pois = read("lucerne/pois.geojson");
const courses: Course[] = read("lucerne/courses.json");
const reachableIdx = courses.find((c) => c.reachable && c.routes.accessible)!.index;

function makeCtx(): AppContext & { ctl: AbortController } {
  document.body.innerHTML = '<div id="map"></div><div id="panel"></div>';
  const ctl = new AbortController();
  return {
    map: { fitTo: vi.fn(), isReady: () => true } as never,
    sheet: mountSheet(document.getElementById("panel")!),
    shell: {
      header: document.createElement("header"),
      panel: document.getElementById("panel")!,
      mapContainer: document.getElementById("map")!,
      setTitle: () => {},
      onThemeChange: () => {},
    },
    index: idx,
    navigate: vi.fn(),
    signal: ctl.signal,
    ctl,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function openPanel(ctx: AppContext, view = courseView("lucerne", reachableIdx)) {
  await view.mount(ctx);
  await flush();
  const root = ctx.sheet.el;
  root.querySelector<HTMLButtonElement>(".course-actions button")!.click();
  await flush();
  return { view, root };
}

function setSlider(root: HTMLElement, i: number, v: string): void {
  const input = root.querySelectorAll<HTMLInputElement>('.conditions input[type="range"]')[i];
  input.value = v;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(loadCourses).mockResolvedValue(courses);
  vi.mocked(loadGraph).mockResolvedValue(graphJson);
  vi.mocked(loadSegments).mockResolvedValue(segs);
  vi.mocked(loadPois).mockResolvedValue(pois);
});
afterEach(() => vi.useRealTimers());

const customCalls = () => vi.mocked(showRoutes).mock.calls.filter((c) => c[3] !== undefined);

describe("conditions panel behaviour", () => {
  it("debounces slider input by 250 ms", async () => {
    const ctx = makeCtx();
    const { root } = await openPanel(ctx);
    expect(customCalls().length).toBe(0);
    setSlider(root, 0, "2");
    vi.advanceTimersByTime(200);
    setSlider(root, 0, "0");
    vi.advanceTimersByTime(200);
    expect(customCalls().length).toBe(0);
    vi.advanceTimersByTime(60);
    expect(customCalls().length).toBe(1);
    expect(showSegments).toHaveBeenCalled();
    expect(currentRoute("lucerne", reachableIdx)?.source).toBe("custom");
    expect(root.querySelector(".diff-table")).not.toBeNull();
    expect(root.querySelector(".conditions input[type=range]")?.getAttribute("aria-valuetext")).toBe("경사 중요도 0.0");
  });

  it("does not recompute after unmount", async () => {
    const ctx = makeCtx();
    const { view, root } = await openPanel(ctx);
    setSlider(root, 0, "2");
    // 계산이 예약만 된 상태: 아직 아무것도 그려지지 않았다
    expect(customCalls().length).toBe(0);
    const statusBefore = root.querySelector(".cond-status")!.textContent;
    view.unmount();
    vi.mocked(showRoutes).mockClear();
    vi.mocked(showSegments).mockClear();
    vi.advanceTimersByTime(1000);
    expect(customCalls().length).toBe(0);
    expect(showRoutes).not.toHaveBeenCalled();
    expect(showSegments).not.toHaveBeenCalled();
    expect(root.querySelector(".cond-status")!.textContent).toBe(statusBefore);
    expect(root.querySelector(".diff-table")).toBeNull();
  });

  it("restores the exported heatmap on unmount after a custom route was applied", async () => {
    const ctx = makeCtx();
    const { view, root } = await openPanel(ctx);
    setSlider(root, 0, "2");
    vi.advanceTimersByTime(300);
    expect(vi.mocked(showSegments).mock.calls.some((c) => c[2] instanceof Float32Array)).toBe(true);
    vi.mocked(showSegments).mockClear();
    view.unmount();
    expect(showSegments).toHaveBeenCalledWith(ctx.map, expect.anything(), null);
  });

  it("ignores data that arrives after abort", async () => {
    let resolveGraph!: (g: unknown) => void;
    vi.mocked(loadGraph).mockReturnValue(new Promise((r) => (resolveGraph = r)) as never);
    const ctx = makeCtx();
    const { root } = await openPanel(ctx);
    expect(root.querySelector(".cond-status")?.textContent).toContain("불러오는 중");
    ctx.ctl.abort();
    resolveGraph(graphJson);
    await flush();
    setSlider(root, 0, "2");
    vi.advanceTimersByTime(1000);
    expect(customCalls().length).toBe(0);
  });

  it("shows Korean warning for a required facility missing nearby", async () => {
    vi.mocked(loadPois).mockResolvedValue({ type: "FeatureCollection", features: [] });
    const ctx = makeCtx();
    const { root } = await openPanel(ctx);
    const toilet = root.querySelector<HTMLInputElement>("#cond-poi-toilet-" + reachableIdx)!;
    toilet.checked = true;
    toilet.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(root.querySelector(".cond-warnings")?.textContent).toContain("경로 300m 안에 화장실이 없어요");
    // required facility with default weights is not "default"
    expect(currentRoute("lucerne", reachableIdx)?.source).toBe("custom");
  });

  it("missingMessage uses the right particle", () => {
    expect(missingMessage("toilet")).toBe("경로 300m 안에 화장실이 없어요");
    expect(missingMessage("elevator")).toBe("경로 300m 안에 엘리베이터가 없어요");
    expect(missingMessage("bench")).toBe("경로 300m 안에 벤치가 없어요");
    expect(missingMessage("fountain")).toBe("경로 300m 안에 음수대가 없어요");
  });

  it("reset restores defaults, default route and exported heatmap immediately", async () => {
    vi.mocked(loadPois).mockResolvedValue({ type: "FeatureCollection", features: [] });
    const ctx = makeCtx();
    const { root } = await openPanel(ctx);
    setSlider(root, 1, "2");
    const toilet = root.querySelector<HTMLInputElement>("#cond-poi-toilet-" + reachableIdx)!;
    toilet.checked = true;
    toilet.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(root.querySelector(".diff-table")).not.toBeNull();
    expect(root.querySelector(".cond-warnings")?.textContent).toContain("화장실이");
    vi.mocked(showSegments).mockClear();
    const reset = [...root.querySelectorAll<HTMLButtonElement>(".conditions button")].find((b) => b.textContent === "기본값으로")!;
    reset.click();
    expect(root.querySelector(".diff-table")).toBeNull();
    expect(toilet.checked).toBe(false);
    expect(root.querySelector(".cond-warnings")?.textContent).toBe("");
    expect(showSegments).toHaveBeenLastCalledWith(ctx.map, expect.anything(), null);
    expect(currentRoute("lucerne", reachableIdx)?.source).toBe("default");
    const first = root.querySelector<HTMLInputElement>('.conditions input[type="range"]')!;
    expect(Number(first.value)).toBe(idx.weights_default.slope);
  });

  it("keeps the status text after the data finishes loading", async () => {
    const ctx = makeCtx();
    const { root } = await openPanel(ctx);
    expect(root.querySelector(".cond-status")?.textContent).toBe("기본 조건이에요");
  });

  it("diff table shows columns, signed deltas with U+2212 and a dash for null", () => {
    const m = { length_m: 1000, steps_count: 2, max_grade_pct: null, steep_m: 100, cobble_m: 0, mean_score: 80, toilets_300m: 3 };
    const n = { length_m: 900, steps_count: 3, max_grade_pct: 5, steep_m: 100, cobble_m: 0, mean_score: 78, toilets_300m: 3 };
    const t = diffTable(m, n);
    expect([...t.querySelectorAll("thead th")].map((h) => h.textContent)).toEqual(["항목", "기본", "내 조건", "차이"]);
    const rows = [...t.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows.map((r) => r[0])).toEqual([
      "거리", "통과 불가 계단", "최대 경사", "6% 이상 경사 구간", "돌길 구간", "평균 점수", "300m 안 화장실",
    ]);
    expect(rows[0]).toEqual(["거리", "1.0km", "900m", "−100m"]);
    expect(rows[1][3]).toBe("+1개");
    expect(rows[2]).toEqual(["최대 경사", "–", "5.0%", "–"]);
    expect(rows[3][3]).toBe("0m");
    expect(rows[5][3]).toBe("−2점");
  });

  describe("AI text box", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
    const aiBody = {
      weights: { slope: 2, surface: 1, kerb: 1, uncertainty: 1 },
      required_pois: ["toilet"],
      explanation: "경사를 크게 피해요",
    };

    it("is hidden when no endpoint is configured", async () => {
      vi.stubEnv("VITE_AI_ENDPOINT", "");
      const { root } = await openPanel(makeCtx());
      expect(root.querySelector(".cond-ai")).toBeNull();
    });

    it("applies weights and required facilities, then recomputes", async () => {
      vi.stubEnv("VITE_AI_ENDPOINT", "https://ai.example.test");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(aiBody), { status: 200 })));
      const { root } = await openPanel(makeCtx());
      const ta = root.querySelector<HTMLTextAreaElement>(".cond-ai textarea")!;
      const btn = root.querySelector<HTMLButtonElement>(".cond-ai button")!;
      expect(btn.disabled).toBe(true);
      ta.value = "언덕이 힘들어요";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      expect(btn.disabled).toBe(false);
      expect(root.querySelector(".cond-ai-count")?.textContent).toBe("8/300");
      vi.mocked(showRoutes).mockClear();
      btn.click();
      expect(btn.textContent).toBe("해석 중…");
      await flush();
      await flush();
      vi.advanceTimersByTime(300);
      const first = root.querySelector<HTMLInputElement>('.conditions input[type="range"]')!;
      expect(Number(first.value)).toBe(2);
      expect(root.querySelector<HTMLInputElement>("#cond-poi-toilet-" + reachableIdx)!.checked).toBe(true);
      expect(root.querySelector(".cond-ai-result")?.textContent).toBe("AI 해석: 경사를 크게 피해요");
      expect(customCalls().length).toBeGreaterThan(0);
      expect(btn.textContent).toBe("AI로 조건 맞추기");
    });

    it("shows the rate limit message and leaves sliders untouched", async () => {
      vi.stubEnv("VITE_AI_ENDPOINT", "https://ai.example.test");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429 })));
      const { root } = await openPanel(makeCtx());
      const ta = root.querySelector<HTMLTextAreaElement>(".cond-ai textarea")!;
      ta.value = "x";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      root.querySelector<HTMLButtonElement>(".cond-ai button")!.click();
      await flush();
      await flush();
      expect(root.querySelector(".cond-ai-result")?.textContent).toBe("오늘 사용 한도를 다 썼어요. 슬라이더로 직접 조절해 보세요.");
      const first = root.querySelector<HTMLInputElement>('.conditions input[type="range"]')!;
      expect(Number(first.value)).toBe(idx.weights_default.slope);
    });
  });
});
