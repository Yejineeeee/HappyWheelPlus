import type { CityEntry } from "../data/types";
import { showCityMarkers } from "../map/layers";
import { el } from "../ui/components";
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

export function homeView(): View {
  return {
    mount(ctx: AppContext) {
      const { cities } = ctx.index;
      ctx.shell.setTitle("HappyWheel+");

      const root = el("div", { class: "home" });
      root.append(el("p", { class: "intro" }, "유럽 9개 도시의 길을 휠체어 접근성으로 분석했어요"));

      for (const [country, list] of groupByCountry(cities)) {
        const group = el("section", { class: "country-group" }, el("h3", {}, country));
        const ul = el("ul", { class: "city-list" });
        for (const c of list) {
          const score = Math.round(c.metrics.mean_score);
          const btn = el(
            "button",
            { type: "button", class: "city-row" },
            el("span", { class: "city-name" }, c.name_ko),
            el("span", { class: "city-meta" }, `코스 ${c.course_count}개`),
            el("span", { class: "city-score" }, `${score}점 · ${scoreLabel(c.metrics.mean_score)}`),
          );
          btn.addEventListener("click", () => ctx.navigate({ name: "city", city: c.id }));
          ul.append(el("li", {}, btn));
        }
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
