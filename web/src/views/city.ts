import type { FeatureCollection, LineString, Point } from "geojson";
import { loadCourses, loadPois, loadSegments } from "../data/load";
import type { CityEntry, Course, PoiKind, PoiProps, SegmentProps } from "../data/types";
import { showPois, showSegments } from "../map/layers";
import { SCORE_STOPS } from "../map/style";
import { badge, el, errorBlock, loadingBlock } from "../ui/components";
import { fmtM, fmtPct, scoreLabel } from "../ui/format";
import { fitTo } from "./mapFit";
import { notFoundView } from "./notFound";
import type { AppContext, View } from "./types";

const POI_KINDS: PoiKind[] = ["toilet", "elevator", "bench", "fountain"];
const POI_LABEL: Record<PoiKind, string> = {
  toilet: "화장실",
  elevator: "엘리베이터",
  bench: "벤치",
  fountain: "음수대",
};

function cityBounds(c: CityEntry): [[number, number], [number, number]] {
  const [lon, lat] = c.center;
  const dLat = c.radius_m / 111320;
  const dLon = c.radius_m / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat + dLat],
  ];
}

function courseCard(c: CityEntry, course: Course, ctx: AppContext): HTMLElement {
  const acc = course.routes.accessible;
  const route = acc ?? course.routes.shortest;
  const score = acc ? acc.metrics.mean_score : null;
  const scoreText = !acc ? "경로 없음" : score === null ? "점수 없음" : `${Math.round(score)}점`;

  const head = el(
    "div",
    { class: "course-head" },
    el("span", { class: "course-name" }, course.name),
    el("span", { class: "course-score" }, scoreText),
  );
  const facts = [fmtM(route.metrics.length_m)];
  if (route.metrics.max_grade_pct !== null) facts.push(`최대 경사 ${route.metrics.max_grade_pct.toFixed(1)}%`);
  const steps = course.comparison?.steps_avoided ?? 0;
  if (steps > 0) facts.push(`계단 ${steps}개 회피`);

  const badges = el("div", { class: "course-badges" });
  if (course.field) {
    badges.append(badge(`현장 난이도 ${course.field.difficulty}/5 · ★${course.field.stars}`, "field"));
  }
  if (course.approximate) badges.append(badge("근사 결과", "warn"));

  const btn = el(
    "button",
    { type: "button", class: "course-card" },
    head,
    el("div", { class: "course-sub" }, `${course.time_label} · ${facts.join(" · ")}`),
  );
  if (badges.childElementCount > 0) btn.append(badges);
  btn.addEventListener("click", () => ctx.navigate({ name: "course", city: c.id, course: course.index }));
  return btn;
}

function metricsSection(c: CityEntry): HTMLElement {
  const m = c.metrics;
  const mean = Math.round(m.mean_score);
  const item = (label: string, value: string) =>
    el("div", { class: "metric" }, el("dt", {}, label), el("dd", {}, value));
  return el(
    "dl",
    { class: "city-metrics" },
    item("평균 점수", `${mean}점 · ${scoreLabel(m.mean_score)}`),
    item(
      "데이터 신뢰도",
      `노면 정보 ${fmtPct(m.surface_coverage * 100)} · 경사 정보 ${fmtPct(m.slope_coverage * 100)}`,
    ),
    item("㎢당 화장실 수", `${m.poi_per_km2.toilet.toFixed(1)}곳`),
  );
}

function legend(): HTMLElement {
  const bar = el("div", { class: "legend-bar", "aria-hidden": "true" });
  bar.style.background = `linear-gradient(to right, ${SCORE_STOPS.map(([v, col]) => `${col} ${v}%`).join(", ")})`;
  const ticks = el(
    "div",
    { class: "legend-ticks", "aria-hidden": "true" },
    ...SCORE_STOPS.map(([v]) => el("span", {}, String(v))),
  );
  const swatch = (cls: string, label: string) =>
    el("li", {}, el("span", { class: `legend-swatch ${cls}`, "aria-hidden": "true" }), label);
  return el(
    "section",
    { class: "legend", "aria-label": "점수 범례" },
    el("h3", {}, "점수 색"),
    el("p", { class: "legend-caption" }, "낮을수록 어렵고 높을수록 편해요"),
    bar,
    ticks,
    el("ul", {}, swatch("swatch-blocked", "통과 불가"), swatch("swatch-unknown", "정보 없음")),
  );
}

export function cityView(cityId: string): View {
  let inner: View | null = null;
  let overlay: HTMLElement | null = null;

  const removeOverlay = () => {
    overlay?.remove();
    overlay = null;
  };

  return {
    async mount(ctx: AppContext) {
      const city = ctx.index.cities.find((c) => c.id === cityId);
      if (!city) {
        inner = notFoundView();
        inner.mount(ctx);
        return;
      }
      ctx.shell.setTitle(city.name_ko, "#/");
      ctx.sheet.setSnap("half");
      fitTo(ctx, cityBounds(city));

      const render = (courses: Course[]) => {
        const visible: Record<PoiKind, boolean> = { toilet: true, elevator: true, bench: true, fountain: true };
        let pois: FeatureCollection<Point, PoiProps> | null = null;

        const segError = el("div", { class: "load-error" });
        const poiError = el("div", { class: "load-error" });
        const counts = new Map<PoiKind, HTMLElement>();
        const countList = el("ul", { class: "poi-counts", "aria-label": "편의시설 수" });
        const chips = el("div", { class: "chips", role: "group", "aria-label": "지도에 보일 편의시설" });
        for (const k of POI_KINDS) {
          const chip = el("button", { type: "button", class: "chip", "aria-pressed": "true" }, POI_LABEL[k]);
          chip.addEventListener("click", () => {
            visible[k] = !visible[k];
            chip.setAttribute("aria-pressed", String(visible[k]));
            if (pois) showPois(ctx.map, pois, visible);
          });
          chips.append(chip);
          const count = el("span", { class: "poi-count" }, "–");
          counts.set(k, count);
          countList.append(el("li", {}, POI_LABEL[k], " ", count));
        }

        const cards = el("div", { class: "course-list" });
        for (const course of courses) cards.append(courseCard(city, course, ctx));

        ctx.sheet.setContent(
          el(
            "div",
            { class: "city" },
            metricsSection(city),
            legend(),
            segError,
            el("h3", {}, "편의시설"),
            chips,
            countList,
            poiError,
            el("h3", {}, `코스 ${courses.length}개`),
            cards,
          ),
        );

        const loadSeg = (): void => {
          segError.replaceChildren();
          if (!overlay) {
            overlay = el(
              "div",
              { class: "map-overlay", role: "status", "aria-live": "polite" },
              el("span", { class: "spinner", "aria-hidden": "true" }),
              el("span", {}, "길 데이터를 불러오는 중"),
            );
            ctx.shell.mapContainer.append(overlay);
          }
          loadSegments(city).then(
            (fc: FeatureCollection<LineString, SegmentProps>) => {
              if (ctx.signal.aborted) return;
              removeOverlay();
              showSegments(ctx.map, fc, null);
            },
            () => {
              if (ctx.signal.aborted) return;
              removeOverlay();
              segError.replaceChildren(errorBlock("길 데이터를 불러오지 못했어요.", loadSeg));
            },
          );
        };

        const loadPoiData = (): void => {
          poiError.replaceChildren();
          loadPois(city).then(
            (fc) => {
              if (ctx.signal.aborted) return;
              pois = fc;
              const n = new Map<PoiKind, number>();
              for (const f of fc.features) n.set(f.properties.kind, (n.get(f.properties.kind) ?? 0) + 1);
              for (const k of POI_KINDS) counts.get(k)!.textContent = `${n.get(k) ?? 0}곳`;
              showPois(ctx.map, fc, visible);
            },
            () => {
              if (ctx.signal.aborted) return;
              poiError.replaceChildren(errorBlock("편의시설 정보를 불러오지 못했어요.", loadPoiData));
            },
          );
        };

        loadSeg();
        loadPoiData();
      };

      const loadCourseList = async (): Promise<void> => {
        ctx.sheet.setContent(loadingBlock("코스를 불러오는 중"));
        let courses: Course[];
        try {
          courses = await loadCourses(city);
        } catch {
          if (ctx.signal.aborted) return;
          ctx.sheet.setContent(errorBlock("코스 정보를 불러오지 못했어요.", () => void loadCourseList()));
          return;
        }
        if (ctx.signal.aborted) return;
        render(courses);
      };

      await loadCourseList();
    },
    unmount() {
      removeOverlay();
      inner?.unmount();
      inner = null;
    },
  };
}
