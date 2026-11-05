import type { CityEntry } from "../data/types";
import { showCityMarkers } from "../map/layers";
import { el, stat, stats } from "../ui/components";
import { scoreLabel } from "../ui/format";
import { fitTo } from "./mapFit";
import type { AppContext, View } from "./types";

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
export function homeStats(cities: CityEntry[]): { cities: number; networkKm: number; courses: number; meanScore: number | null } {
  const networkKm = cities.reduce((a, c) => a + c.metrics.network_km, 0);
  const courses = cities.reduce((a, c) => a + c.course_count, 0);
  const meanScore = cities.length > 0 ? cities.reduce((a, c) => a + c.metrics.mean_score, 0) / cities.length : null;
  return { cities: cities.length, networkKm, courses, meanScore };
}

function summaryStats(cities: CityEntry[]): HTMLElement {
  const s = homeStats(cities);
  return stats(
    [
      stat("도시", String(s.cities), { unit: "곳" }),
      stat("코스", String(s.courses), { unit: "개" }),
      stat("분석한 길", Math.round(s.networkKm).toLocaleString("ko-KR"), { unit: "km" }),
      stat("평균 점수", s.meanScore === null ? "–" : String(Math.round(s.meanScore)), { unit: s.meanScore === null ? "" : "점" }),
    ],
    "stats-summary",
  );
}

function thumbUrl(c: CityEntry): string {
  return `${import.meta.env.BASE_URL}data/${c.id}/thumb.webp?v=${c.data_version}`;
}

function cityCard(c: CityEntry, onClick: () => void): HTMLElement {
  const score = Math.round(c.metrics.mean_score);
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
      el("span", { class: "score-num" }, String(score)),
      el("span", { class: "score-unit" }, "점"),
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
      ctx.shell.setTitle("HappyWheel+");

      const root = el("div", { class: "home" });
      root.append(el("p", { class: "lead" }, `유럽 ${cities.length}개 도시의 길을 휠체어 접근성으로 분석했어요`));
      root.append(summaryStats(cities));

      for (const [country, list] of groupByCountry(cities)) {
        const group = el("section", { class: "country-group" }, el("h3", { class: "section-title" }, country));
        const ul = el("ul", { class: "city-list" });
        for (const c of list) ul.append(el("li", {}, cityCard(c, () => ctx.navigate({ name: "city", city: c.id }))));
        group.append(ul);
        root.append(group);
      }

      root.append(
        el(
          "div",
          { class: "home-links" },
          el("a", { href: "#/compare", class: "btn" }, "도시 비교"),
          el("a", { href: "#/about", class: "btn btn-quiet" }, "분석 방법"),
        ),
      );
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
