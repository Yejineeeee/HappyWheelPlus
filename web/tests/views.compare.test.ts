import { describe, expect, it, vi } from "vitest";
import type { CityIndex } from "../src/data/types";

vi.mock("../src/map/layers", () => ({ showCityMarkers: vi.fn() }));

import { showCityMarkers } from "../src/map/layers";
import { mountSheet } from "../src/ui/sheet";
import { profileChart } from "../src/ui/profileChart";
import { aboutView } from "../src/views/about";
import { compareView } from "../src/views/compare";
import type { AppContext } from "../src/views/types";

const mk = (id: string, name: string, score: number) => ({
  id,
  name_ko: name,
  country_ko: "x",
  center: [id === "a" ? 1 : 2, 48] as [number, number],
  radius_m: 1000,
  data_version: "v",
  course_count: 1,
  metrics: {
    mean_score: score,
    blocked_share: 0,
    surface_coverage: 0.7,
    slope_coverage: 0.95,
    network_km: 1,
    area_km2: 1,
    poi_per_km2: { toilet: 2, elevator: 1, bench: 10, fountain: 1 },
    surface_mix: { smooth: 0.5, paving: 0.2, compacted: 0, cobble: 0, unpaved: 0, unknown: 0.3 },
  },
});
const INDEX: CityIndex = {
  generated_at: "x",
  weights_default: { slope: 1, surface: 0.8, kerb: 0.6, uncertainty: 0.3 },
  alpha: 3,
  cities: [mk("a", "가도시", 90), mk("b", "나도시", 60)],
};

function ctx(): AppContext & { titles: string[] } {
  document.body.innerHTML = '<div id="map"></div><div id="panel"></div>';
  const titles: string[] = [];
  return {
    map: { fitTo: vi.fn() } as never,
    sheet: mountSheet(document.getElementById("panel")!),
    shell: {
      header: document.createElement("header"),
      panel: document.getElementById("panel")!,
      mapContainer: document.getElementById("map")!,
      setTitle: (t: string) => titles.push(t),
      onThemeChange: () => {},
    },
    index: INDEX,
    navigate: vi.fn(),
    signal: new AbortController().signal,
    titles,
  };
}

describe("compare and about views", () => {
  it("compare renders four charts with headings, sentences and table toggles", () => {
    const c = ctx();
    const v = compareView();
    v.mount(c);
    expect(c.titles[0]).toBe("도시 비교");
    expect(c.sheet.el.querySelectorAll("h2").length).toBe(4);
    expect(c.sheet.el.querySelectorAll('[role="img"]').length).toBe(4);
    expect(showCityMarkers).toHaveBeenCalled();
    const toggle = c.sheet.el.querySelector<HTMLButtonElement>(".chart-toggle")!;
    const table = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(table.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(table.hidden).toBe(false);
    expect(table.querySelectorAll("tbody tr").length).toBe(2);
    v.unmount();
  });

  it("compare redraws when data-theme changes and stops after unmount", async () => {
    const c = ctx();
    const v = compareView();
    v.mount(c);
    const before = c.sheet.el.querySelector(".chart-plot svg");
    document.documentElement.setAttribute("data-theme", "dark");
    await new Promise((r) => setTimeout(r, 20));
    const after = c.sheet.el.querySelector(".chart-plot svg");
    expect(after).not.toBe(before);
    v.unmount();
    document.documentElement.setAttribute("data-theme", "light");
    await new Promise((r) => setTimeout(r, 20));
    expect(c.sheet.el.querySelector(".chart-plot svg")).toBe(after);
  });

  it("profile chart redraws when data-theme changes", async () => {
    const holder = document.createElement("div");
    document.body.append(holder);
    holder.append(profileChart([[0, 10, 1], [25, 12, 2], [50, 11, 3]]));
    const before = holder.querySelector("svg");
    document.documentElement.setAttribute("data-theme", "dark");
    await new Promise((r) => setTimeout(r, 20));
    expect(holder.querySelector("svg")).not.toBe(before);
  });

  it("about shows the model sections and repository links", () => {
    const c = ctx();
    aboutView().mount(c);
    expect(c.titles[0]).toBe("분석 방법");
    const heads = [...c.sheet.el.querySelectorAll("h2")].map((h) => h.textContent);
    expect(heads).toEqual(["프로젝트 배경", "데이터", "점수 모델", "지형 보정", "정류장 연결 규칙", "한계", "링크"]);
    const hrefs = [...c.sheet.el.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://github.com/Yejineeeee/HappyWheelPlus");
    expect(hrefs).toContain("https://github.com/Yejineeeee/HappyWheelPlus/blob/main/pipeline/notebooks/methodology.ipynb");
  });
});
