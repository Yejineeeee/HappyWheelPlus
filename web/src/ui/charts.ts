import type { CityIndex, PoiKind, SurfaceClass } from "../data/types";

/** 누적 막대와 범례의 순서: 매끈함 → 정보 없음. */
export const SURFACE_ORDER: SurfaceClass[] = ["smooth", "paving", "compacted", "cobble", "unpaved", "unknown"];

export const SURFACE_LABEL: Record<SurfaceClass, string> = {
  smooth: "매끈함",
  paving: "포장블록",
  compacted: "다짐",
  cobble: "돌길",
  unpaved: "비포장",
  unknown: "정보 없음",
};

export const POI_KINDS: PoiKind[] = ["toilet", "elevator", "bench", "fountain"];

export const POI_LABEL: Record<PoiKind, string> = {
  toilet: "화장실",
  elevator: "엘리베이터",
  bench: "벤치",
  fountain: "음수대",
};

/** 평균 점수 높은 순. 원본 배열은 바꾸지 않는다. */
export function sortedScores(index: CityIndex): { id: string; city: string; score: number }[] {
  return index.cities
    .map((c) => ({ id: c.id, city: c.name_ko, score: c.metrics.mean_score }))
    .sort((a, b) => b.score - a.score);
}

function byScore(index: CityIndex) {
  return [...index.cities].sort((a, b) => b.metrics.mean_score - a.metrics.mean_score);
}

export function surfaceMixRows(index: CityIndex): { city: string; cls: SurfaceClass; share: number }[] {
  return byScore(index).flatMap((c) =>
    SURFACE_ORDER.map((cls) => ({ city: c.name_ko, cls, share: c.metrics.surface_mix[cls] ?? 0 })),
  );
}

export function poiDensityRows(index: CityIndex): { city: string; kind: PoiKind; perKm2: number }[] {
  return byScore(index).flatMap((c) =>
    POI_KINDS.map((kind) => ({ city: c.name_ko, kind, perKm2: c.metrics.poi_per_km2[kind] ?? 0 })),
  );
}

export function coverageRows(index: CityIndex): { city: string; metric: "surface" | "slope"; share: number }[] {
  return byScore(index).flatMap((c) => [
    { city: c.name_ko, metric: "surface" as const, share: c.metrics.surface_coverage },
    { city: c.name_ko, metric: "slope" as const, share: c.metrics.slope_coverage },
  ]);
}

function extremes<T>(items: T[], value: (t: T) => number): { max: T; min: T } {
  let max = items[0];
  let min = items[0];
  for (const it of items) {
    if (value(it) > value(max)) max = it;
    if (value(it) < value(min)) min = it;
  }
  return { max, min };
}

const DIGIT_BATCHIM = [true, true, false, true, false, false, true, true, true, false];

/** 마지막 읽는 글자에 받침이 있는지. 닫는 괄호는 건너뛰고 %는 "퍼센트"(받침 없음), 숫자는 한글 읽기 기준. */
function hasBatchim(word: string): boolean {
  const s = word.replace(/[)\]}>"'.\s]+$/, "");
  const ch = s.slice(-1);
  if (ch === "%") return false;
  if (/[0-9]/.test(ch)) return DIGIT_BATCHIM[Number(ch)];
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  return false;
}

/** 받침이 있으면 withBatchim, 없으면 without을 붙인다. 예: josa("화장실", "이", "가") → "화장실이". */
export function josa(word: string, withBatchim: string, without: string): string {
  return word + (hasBatchim(word) ? withBatchim : without);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function scoreSentence(index: CityIndex): string {
  if (index.cities.length === 0) return "";
  const { max, min } = extremes(index.cities, (c) => c.metrics.mean_score);
  const a = `${max.name_ko}(${Math.round(max.metrics.mean_score)}점)`;
  const b = `${min.name_ko}(${Math.round(min.metrics.mean_score)}점)`;
  return `평균 점수가 가장 높은 도시는 ${a}, 가장 낮은 도시는 ${josa(b, "이에요", "예요")}`;
}

export function surfaceSentence(index: CityIndex): string {
  if (index.cities.length === 0) return "";
  const { max, min } = extremes(index.cities, (c) => c.metrics.surface_mix.unknown);
  const a = `${max.name_ko}(${pct(max.metrics.surface_mix.unknown)})`;
  const b = `${min.name_ko}(${pct(min.metrics.surface_mix.unknown)})`;
  return `노면 정보가 없는 길 비율이 가장 큰 도시는 ${a}, 가장 작은 도시는 ${josa(b, "이에요", "예요")}`;
}

export function poiSentence(index: CityIndex): string {
  if (index.cities.length === 0) return "";
  const { max, min } = extremes(index.cities, (c) => c.metrics.poi_per_km2.toilet);
  const f = (c: typeof max) => `${c.name_ko}(${c.metrics.poi_per_km2.toilet.toFixed(1)}개)`;
  return `㎢당 화장실은 ${josa(f(max), "이", "가")} 가장 많고 ${josa(f(min), "이", "가")} 가장 적어요`;
}

export function coverageSentence(index: CityIndex): string {
  if (index.cities.length === 0) return "";
  const s = extremes(index.cities, (c) => c.metrics.surface_coverage).min;
  const g = extremes(index.cities, (c) => c.metrics.slope_coverage).min;
  return `노면 정보 비율이 가장 낮은 도시는 ${s.name_ko}(${pct(s.metrics.surface_coverage)}), 경사 정보 비율이 가장 낮은 도시는 ${g.name_ko}(${pct(g.metrics.slope_coverage)})예요`;
}
