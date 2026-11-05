import { describe, expect, it } from "vitest";
import type { CityEntry, CityIndex, SurfaceClass } from "../src/data/types";
import {
  SURFACE_ORDER,
  josa,
  coverageRows,
  coverageSentence,
  poiDensityRows,
  poiSentence,
  scoreSentence,
  sortedScores,
  surfaceMixRows,
  surfaceSentence,
} from "../src/ui/charts";

function city(id: string, name: string, score: number, unknown: number, sc: number, sl: number, toilet: number): CityEntry {
  const mix = { smooth: 1 - unknown - 0.2, paving: 0.2, compacted: 0, cobble: 0, unpaved: 0, unknown } as Record<SurfaceClass, number>;
  return {
    id,
    name_ko: name,
    country_ko: "x",
    center: [0, 0],
    radius_m: 1000,
    data_version: "v",
    course_count: 1,
    metrics: {
      mean_score: score,
      blocked_share: 0,
      surface_coverage: sc,
      slope_coverage: sl,
      network_km: 1,
      area_km2: 1,
      poi_per_km2: { toilet, elevator: 1, bench: 20, fountain: 2 },
      surface_mix: mix,
    },
  };
}

const INDEX: CityIndex = {
  generated_at: "x",
  weights_default: { slope: 1, surface: 0.8, kerb: 0.6, uncertainty: 0.3 },
  alpha: 3,
  cities: [
    city("a", "인터라켄", 51.9, 0.47, 0.53, 0.99, 0.9),
    city("b", "밀라노", 92.8, 0.2, 0.8, 0.98, 2.5),
    city("c", "파리", 87.2, 0.3, 0.7, 0.95, 15.6),
  ],
};

describe("chart data", () => {
  it("surfaceMixRows sums to 1 per city", () => {
    const rows = surfaceMixRows(INDEX);
    expect(rows).toHaveLength(3 * 6);
    for (const c of INDEX.cities) {
      const sum = rows.filter((r) => r.city === c.name_ko).reduce((s, r) => s + r.share, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
    // 도시 안에서는 매끈함 → 정보 없음 순서
    expect(rows.filter((r) => r.city === "파리").map((r) => r.cls)).toEqual(SURFACE_ORDER);
  });

  it("cities sorted by mean score desc", () => {
    expect(sortedScores(INDEX).map((r) => r.city)).toEqual(["밀라노", "파리", "인터라켄"]);
    expect(sortedScores(INDEX)[0].score).toBe(92.8);
    // 원본 순서를 바꾸지 않는다
    expect(INDEX.cities[0].id).toBe("a");
  });

  it("poiDensityRows and coverageRows follow score order", () => {
    const poi = poiDensityRows(INDEX);
    expect(poi).toHaveLength(12);
    expect(poi[0]).toEqual({ city: "밀라노", kind: "toilet", perKm2: 2.5 });
    const cov = coverageRows(INDEX);
    expect(cov).toHaveLength(6);
    expect(cov.find((r) => r.city === "인터라켄" && r.metric === "surface")?.share).toBe(0.53);
    expect(cov.find((r) => r.city === "인터라켄" && r.metric === "slope")?.share).toBe(0.99);
  });

  it("interpretation sentences are computed from data", () => {
    expect(scoreSentence(INDEX)).toBe("평균 점수가 가장 높은 도시는 밀라노(93점), 가장 낮은 도시는 인터라켄(52점)이에요");
    expect(surfaceSentence(INDEX)).toBe("노면 정보가 없는 길 비율이 가장 큰 도시는 인터라켄(47%), 가장 작은 도시는 밀라노(20%)예요");
    expect(poiSentence(INDEX)).toBe("㎢당 화장실은 파리(15.6개)가 가장 많고 인터라켄(0.9개)이 가장 적어요");
    expect(coverageSentence(INDEX)).toBe("노면 정보 비율이 가장 낮은 도시는 인터라켄(53%), 경사 정보 비율이 가장 낮은 도시는 파리(95%)예요");
  });

  it("sentences stay safe with a single city or none", () => {
    const one = { ...INDEX, cities: [INDEX.cities[0]] };
    expect(scoreSentence(one)).toContain("인터라켄");
    expect(scoreSentence({ ...INDEX, cities: [] })).toBe("");
    expect(poiSentence({ ...INDEX, cities: [] })).toBe("");
  });
});

describe("josa", () => {
  it("picks the particle by the last word before any parenthesis", () => {
    expect(josa("화장실", "이", "가")).toBe("화장실이");
    expect(josa("엘리베이터", "이", "가")).toBe("엘리베이터가");
    // 괄호 앞 낱말(도시 이름)의 받침으로 정한다.
    expect(josa("인터라켄(0.9개)", "이", "가")).toBe("인터라켄(0.9개)이");
    expect(josa("파리(15.6개)", "이", "가")).toBe("파리(15.6개)가");
    expect(josa("밀라노(93%)", "이에요", "예요")).toBe("밀라노(93%)예요");
    expect(josa("베네치아(93%)", "이에요", "예요")).toBe("베네치아(93%)예요");
    expect(josa("인터라켄(52점)", "이에요", "예요")).toBe("인터라켄(52점)이에요");
    expect(josa("93%", "이", "가")).toBe("93%가");
    expect(josa("3", "은", "는")).toBe("3은");
    expect(josa("5", "은", "는")).toBe("5는");
  });
});
