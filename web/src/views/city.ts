import type { FeatureCollection, LineString, Point } from "geojson";
import { loadCourses, loadPois, loadSegments } from "../data/load";
import type { CityEntry, Course, PoiKind, PoiProps, SegmentProps } from "../data/types";
import { showPois, showSegments } from "../map/layers";
import { SCORE_STOPS } from "../map/style";
import { badge, el, errorBlock, loadingBlock, stat, stats } from "../ui/components";
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
  const scoreEl = el("span", { class: "course-score" });
  if (acc && score !== null) {
    scoreEl.append(
      el("span", { class: "visually-hidden" }, "접근성 점수 "),
      el("span", { class: "score-num" }, String(Math.round(score))),
      el("span", { class: "score-unit" }, "점"),
    );
  } else {
    scoreEl.classList.add("is-empty");
    scoreEl.append(scoreText);
  }

  const head = el(
    "div",
    { class: "course-head" },
    el("span", { class: "course-name" }, course.name),
    scoreEl,
  );
  const facts = [fmtM(route.metrics.length_m)];
  if (route.metrics.max_grade_pct !== null) facts.push(`최대 경사 ${route.metrics.max_grade_pct.toFixed(1)}%`);
  const steps = course.comparison?.steps_avoided ?? 0;

  const badges = el("div", { class: "course-badges" });
  if (steps > 0) badges.append(badge(`계단 ${steps}개 회피`, "good"));
  if (course.field) {
    const b = badge(`현장 난이도 ${course.field.difficulty}/5 · `, "field");
    b.append(
      el("span", { "aria-hidden": "true" }, `★${course.field.stars}`),
      el("span", { class: "visually-hidden" }, `현장 별점 ${course.field.stars}`),
    );
    badges.append(b);
  }
  if (course.approximate) badges.append(badge("근사 결과", "warn"));

  const btn = el(
    "button",
    { type: "button", class: "card course-card" },
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
  return el(
    "div",
    { class: "city-metrics" },
    stats(
      [
        stat("평균 점수", String(mean), { unit: "점", hint: scoreLabel(m.mean_score), size: "lg" }),
        stat("분석한 길", Math.round(m.network_km).toLocaleString("ko-KR"), { unit: "km" }),
        stat("㎢당 화장실", m.poi_per_km2.toilet.toFixed(1), { unit: "곳" }),
      ],
      "stats-3",
    ),
    el(
      "p",
      { class: "city-coverage" },
      `데이터 신뢰도 · 노면 정보 ${fmtPct(m.surface_coverage * 100)} · 경사 정보 ${fmtPct(m.slope_coverage * 100)}`,
    ),
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
    el("h3", { class: "section-title" }, "점수 색"),
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
        // 벤치는 수가 많아 처음에는 끈다.
        const visible: Record<PoiKind, boolean> = { toilet: true, elevator: true, bench: false, fountain: true };
        let pois: FeatureCollection<Point, PoiProps> | null = null;

        const segError = el("div", { class: "load-error" });
        const poiError = el("div", { class: "load-error" });
        const counts = new Map<PoiKind, HTMLElement>();
        const countList = el("ul", { class: "poi-counts", "aria-label": "편의시설 수" });
        const chips = el("div", { class: "chips", role: "group", "aria-label": "지도에 보일 편의시설" });
        for (const k of POI_KINDS) {
          const chip = el("button", { type: "button", class: "chip", "aria-pressed": String(visible[k]) }, POI_LABEL[k]);
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
            el("h3", { class: "section-title" }, "편의시설"),
            chips,
            countList,
            poiError,
            el("h3", { class: "section-title" }, `코스 ${courses.length}개`),
            cards,
          ),
        );

        const loadSeg = (): void => {
          segError.replaceChildren();
          if (!overlay) {
            // 빈 알림 영역을 먼저 넣고 다음 프레임에 문구를 채워야 스크린 리더가 읽는다.
            const box = el("div", { class: "map-overlay", role: "status", "aria-live": "polite" });
            overlay = box;
            ctx.shell.mapContainer.append(box);
            requestAnimationFrame(() => {
              if (overlay !== box) return;
              box.append(
                el("span", { class: "spinner", "aria-hidden": "true" }),
                el("span", {}, "길 데이터를 불러오는 중"),
              );
            });
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

      const retryCourses = (): void => {
        loadCourseList().catch(() => {
          if (ctx.signal.aborted) return;
          ctx.sheet.setContent(errorBlock("코스 정보를 표시하지 못했어요.", retryCourses));
        });
      };

      const loadCourseList = async (): Promise<void> => {
        ctx.sheet.setContent(loadingBlock("코스를 불러오는 중"));
        let courses: Course[];
        try {
          courses = await loadCourses(city);
        } catch {
          if (ctx.signal.aborted) return;
          ctx.sheet.setContent(errorBlock("코스 정보를 불러오지 못했어요.", retryCourses));
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
