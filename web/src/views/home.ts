import type { CityEntry } from "../data/types";
import { showCityMarkers } from "../map/layers";
import { el } from "../ui/components";
import { scoreLabel } from "../ui/format";
import { scoreColor } from "../map/style";
import { fitTo } from "./mapFit";
import type { AppContext, View } from "./types";

export const HOME_PEEK = 220;

function groupByCountry(cities: CityEntry[]): [string, CityEntry[]][] {
  const groups = new Map<string, CityEntry[]>();
  for (const c of cities) {
    const list = groups.get(c.country_ko);
    if (list) list.push(c);
    else groups.set(c.country_ko, [c]);
  }
  return [...groups];
}

/** 홈 첫 화면 수치: cities.json 지표만으로 계산한다(코스 파일은 불러오지 않는다). */
export function homeStats(cities: CityEntry[]): {
  countries: number;
  cities: number;
  networkKm: number;
  courses: number;
} {
  const networkKm = cities.reduce((a, c) => a + c.metrics.network_km, 0);
  const courses = cities.reduce((a, c) => a + c.course_count, 0);
  const countries = new Set(cities.map((c) => c.country_ko)).size;
  return { countries, cities: cities.length, networkKm, courses };
}

/** 첫 화면 소개 문장. 숫자만 조금 굵게 보인다. */
export function introSentence(cities: CityEntry[]): HTMLElement {
  const s = homeStats(cities);
  const n = (v: string) => el("span", { class: "num" }, v);
  return el(
    "p",
    { class: "intro" },
    n(`${s.countries}개국 ${s.cities}개 도시`),
    ", 길 ",
    n(`${Math.round(s.networkKm).toLocaleString("ko-KR")}km`),
    "를 구간마다 채점했어요. 탐방 코스 ",
    n(`${s.courses}개`),
    "를 최단 경로와 비교해요.",
  );
}

function thumbUrl(c: CityEntry): string {
  return `${import.meta.env.BASE_URL}data/${c.id}/thumb.webp?v=${c.data_version}`;
}

function cityCard(c: CityEntry, onClick: () => void): HTMLElement {
  const score = Math.round(c.metrics.mean_score);
  const dot = el("span", { class: "score-dot", "aria-hidden": "true" });
  dot.style.background = scoreColor(c.metrics.mean_score);
  const img = el("img", { class: "city-thumb", src: thumbUrl(c), alt: "", width: "96", height: "64", loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.classList.add("is-missing"));
  const btn = el(
    "button",
    { type: "button", class: "card city-row" },
    el("span", { class: "city-thumb-frame", "aria-hidden": "true" }, img),
    el(
      "span",
      { class: "city-text" },
      el("span", { class: "city-name" }, c.name_ko),
      el("span", { class: "city-meta" }, `${c.country_ko} · 코스 ${c.course_count}개`),
    ),
    el(
      "span",
      { class: "city-score" },
      el("span", { class: "visually-hidden" }, "평균 점수 "),
      dot,
      el("span", { class: "score-num" }, String(score)),
      el("span", { class: "score-label" }, scoreLabel(c.metrics.mean_score)),
    ),
  );
  btn.addEventListener("click", onClick);
  return btn;
}

export function homeView(): View {
  return {
    mount(ctx: AppContext) {
      const { cities } = ctx.index;
      ctx.shell.setTitle(null);
      // 좁은 화면 첫 높이: 소개 문장 아래 도시 카드 한 장이 보이게.
      ctx.sheet.setPeek(HOME_PEEK);
      ctx.sheet.setSnap("peek");

      const root = el("div", { class: "home" });
      root.append(introSentence(cities));

      for (const [country, list] of groupByCountry(cities)) {
        const group = el("section", { class: "country-group" }, el("h3", { class: "section-title" }, country));
        const ul = el("ul", { class: "city-list" });
        for (const c of list) ul.append(el("li", {}, cityCard(c, () => ctx.navigate({ name: "city", city: c.id }))));
        group.append(ul);
        root.append(group);
      }

      ctx.sheet.setContent(root);

      showCityMarkers(ctx.map, cities, (id) => ctx.navigate({ name: "city", city: id }));
      if (cities.length > 0) {
        const lons = cities.map((c) => c.center[0]);
        const lats = cities.map((c) => c.center[1]);
        fitTo(ctx, [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ]);
      }
    },
    unmount() {},
  };
}
