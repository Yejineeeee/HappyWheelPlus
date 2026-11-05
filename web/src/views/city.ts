import { HOME_CRUMB } from "../ui/shell";
import type { FeatureCollection, LineString, Point } from "geojson";
import { loadCourses, loadPois, loadSegments } from "../data/load";
import type { CityEntry, Course, PoiKind, PoiProps, SegmentProps } from "../data/types";
import { showPois, showSegments } from "../map/layers";
import { SCORE_STOPS, scoreColor } from "../map/style";
import { badge, el, errorBlock, kvList, loadingBlock, scoreMeter } from "../ui/components";
import { fmtM, scoreLabel } from "../ui/format";
import { loadingOverlay, type LoadingOverlay } from "../ui/overlay";
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
    const dot = el("span", { class: "score-dot", "aria-hidden": "true" });
    dot.style.background = scoreColor(score);
    scoreEl.append(
      el("span", { class: "visually-hidden" }, "점수 "),
      dot,
      el("span", { class: "score-num" }, String(Math.round(score))),
      el("span", { class: "score-label" }, scoreLabel(score)),
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

  // 카드에는 계산 결과만 둔다. 탐방팀 현장 기록은 코스 상세에서 보여 준다.
  const badges = el("div", { class: "course-badges" });
  if (steps > 0) badges.append(badge(`계단 ${steps}개 피함`, "good"));
  if (course.approximate) badges.append(badge("위치 오차 있음", "warn"));

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

const pctInt = (share: number) => `${Math.round(share * 100)}%`;

function metricsSection(c: CityEntry): HTMLElement {
  const m = c.metrics;
  return el(
    "div",
    { class: "city-metrics" },
    kvList([
      { label: "평균 점수", value: scoreMeter(m.mean_score) },
      { label: "분석한 길", value: `${Math.round(m.network_km).toLocaleString("ko-KR")}km` },
      { label: "1㎢마다 화장실", value: `${m.poi_per_km2.toilet.toFixed(1)}곳` },
      { label: "노면이 기록된 길", value: pctInt(m.surface_coverage) },
      { label: "경사를 잰 길", value: pctInt(m.slope_coverage) },
    ]),
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
    el("ul", {}, swatch("swatch-blocked", "지나갈 수 없는 길"), swatch("swatch-unknown", "정보 없음")),
  );
}

/** 좁은 화면 판단(시트 배치). 넓은 화면은 지표를 펼쳐 둔다. */
function isNarrow(): boolean {
  return !(window.matchMedia?.("(min-width: 1024px)").matches ?? false);
}

/** 접기 영역: aria-expanded 버튼 + 내용. 처음에는 접혀 있다. */
export function disclosure(label: string, id: string, ...children: Node[]): HTMLElement {
  const body = el("div", { class: "disclosure-body", id, hidden: "" }, ...children);
  const btn = el(
    "button",
    { type: "button", class: "disclosure-btn", "aria-expanded": "false", "aria-controls": id },
    el("span", {}, label),
    el("span", { class: "disclosure-icon", "aria-hidden": "true" }),
  );
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
  });
  return el("div", { class: "disclosure" }, btn, body);
}

export function cityView(cityId: string): View {
  let inner: View | null = null;
  let overlay: LoadingOverlay | null = null;
  let stopMq: (() => void) | null = null;

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
      ctx.shell.setTitle(city.name_ko, [HOME_CRUMB]);
      ctx.sheet.setSnap("half");
      fitTo(ctx, cityBounds(city));

      const render = (courses: Course[]) => {
        // 벤치는 수가 많아 처음에는 끈다.
        const visible: Record<PoiKind, boolean> = { toilet: true, elevator: true, bench: false, fountain: true };
        let pois: FeatureCollection<Point, PoiProps> | null = null;

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

        const courseSection: Node[] = [el("h3", { class: "section-title" }, `코스 ${courses.length}개`), cards];
        const settings: Node[] = [metricsSection(city), legend(), el("h3", { class: "section-title" }, "편의시설"), chips, countList];
        // 좁은 화면: 코스 카드를 맨 위에, 지표·범례·편의시설은 "지도 보기 설정" 접기 영역으로.
        // 편의시설 오류는 접힌 영역 밖(코스 목록 위)에 보인다. 화면 폭이 바뀌면 구조를 다시 짠다.
        const build = (): HTMLElement =>
          isNarrow()
            ? el(
                "div",
                { class: "city is-narrow" },
                poiError,
                ...courseSection,
                disclosure("지도 보기 설정", `city-settings-${city.id}`, ...settings),
              )
            : el("div", { class: "city" }, ...settings, poiError, ...courseSection);
        ctx.sheet.setContent(build());
        const mq = window.matchMedia?.("(min-width: 1024px)");
        if (mq) {
          const onChange = (): void => {
            if (ctx.signal.aborted) return;
            ctx.sheet.setContent(build());
          };
          mq.addEventListener?.("change", onChange);
          stopMq = () => mq.removeEventListener?.("change", onChange);
        }

        const loadSeg = (): void => {
          if (overlay) overlay.loading();
          else overlay = loadingOverlay(ctx.shell.mapContainer, `${city.name_ko} 길 데이터를 불러오는 중…`);
          loadSegments(city, ctx.signal).then(
            (fc: FeatureCollection<LineString, SegmentProps>) => {
              if (ctx.signal.aborted) return;
              removeOverlay();
              showSegments(ctx.map, fc, null);
            },
            () => {
              if (ctx.signal.aborted) return;
              // 실패하면 지도 위 같은 자리에서 다시 시도한다.
              overlay?.fail("길 데이터를 불러오지 못했어요.", loadSeg);
            },
          );
        };

        const loadPoiData = (): void => {
          poiError.replaceChildren();
          loadPois(city, ctx.signal).then(
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
          courses = await loadCourses(city, ctx.signal);
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
      stopMq?.();
      stopMq = null;
      removeOverlay();
      inner?.unmount();
      inner = null;
    },
  };
}
