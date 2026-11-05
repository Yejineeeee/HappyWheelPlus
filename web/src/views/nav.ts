import { currentRoute } from "../core/conditions";
import { distM } from "../core/geo";
import { loadCourses, loadSegments } from "../data/load";
import type { Course, SegmentProps } from "../data/types";
import { prefersReducedMotion, showRouteProgress, showRoutes, showStops, showUser } from "../map/layers";
import { buildInstructions, type Instruction } from "../nav/instructions";
import { startNav, type NavHandle, type NavSource, type NavUpdate } from "../nav/controller";
import { cumulative, locateForward, splitAt } from "../nav/progress";
import { el, errorBlock, loadingBlock } from "../ui/components";
import { fmtM } from "../ui/format";
import { fitPadding } from "./mapFit";
import { notFoundView } from "./notFound";
import type { AppContext, View } from "./types";

type LngLat = [number, number];
type SegFeature = { geometry: { coordinates: number[][] }; properties: SegmentProps };

const MIN_ZOOM = 16;

/** 경로를 이루는 구간마다 경로 위 [시작, 끝] 거리를 구한다. 구간 좌표는 u→v 방향이라 진행 방향에 맞춰 뒤집어 잇는다. */
export function segmentSpans(
  coords: LngLat[],
  segIds: number[],
  features: SegFeature[],
): { segId: number; startM: number; endM: number; props: SegmentProps }[] {
  if (coords.length < 2 || segIds.length === 0) return [];
  const total = cumulative(coords)[coords.length - 1];
  const out: { segId: number; startM: number; endM: number; props: SegmentProps }[] = [];
  let at = 0;
  let end: LngLat = coords[0];
  for (const id of segIds) {
    const f = features[id];
    if (!f) continue;
    let c = f.geometry.coordinates as LngLat[];
    if (c.length < 2) continue;
    if (distM(end, c[0]) > distM(end, c[c.length - 1])) c = c.slice().reverse();
    let len = 0;
    for (let i = 1; i < c.length; i++) len += distM(c[i - 1], c[i]);
    out.push({ segId: id, startM: at, endM: at + len, props: f.properties });
    at += len;
    end = c[c.length - 1];
  }
  // 합계가 경로 길이와 조금 어긋나도 구간이 경로 안에 놓이도록 맞춘다.
  if (at > 0 && Math.abs(at - total) > 1) {
    const k = total / at;
    for (const s of out) {
      s.startM *= k;
      s.endM *= k;
    }
  }
  return out;
}

/** 정류장을 순서대로 투영한다. 앞 정류장의 위치부터 찾으므로 왕복 구간에서도 순서가 유지된다. */
export function projectStops(
  coords: LngLat[],
  cum: Float64Array,
  stops: { name: string; lon: number; lat: number }[],
): { name: string; atM: number }[] {
  let from = 0;
  return stops.map((s) => {
    const atM = locateForward(coords, cum, [s.lon, s.lat], from);
    from = atM;
    return { name: s.name, atM };
  });
}

export function navView(cityId: string, courseIndex: number): View {
  let inner: View | null = null;
  let nav: NavHandle | null = null;
  let mapRef: AppContext["map"] | null = null;
  let touchedMap = false;

  const stopNav = (): void => {
    nav?.stop();
    nav = null;
  };

  return {
    async mount(ctx: AppContext) {
      const city = ctx.index.cities.find((c) => c.id === cityId);
      if (!city) {
        inner = notFoundView();
        inner.mount(ctx);
        return;
      }
      mapRef = ctx.map;

      const loadAll = async (): Promise<void> => {
        ctx.sheet.setContent(loadingBlock("길안내를 준비하는 중"));
        let courses: Course[];
        try {
          courses = await loadCourses(city);
        } catch {
          if (ctx.signal.aborted) return;
          ctx.sheet.setContent(errorBlock("코스 정보를 불러오지 못했어요.", () => void loadAll()));
          return;
        }
        if (ctx.signal.aborted) return;
        const course = courses.find((c) => c.index === courseIndex);
        if (!course) {
          inner = notFoundView();
          inner.mount(ctx);
          return;
        }
        // 구간 정보는 크지만 없어도 회전·도착 안내는 가능하다.
        let features: SegFeature[] = [];
        try {
          features = (await loadSegments(city)).features as unknown as SegFeature[];
        } catch {
          features = [];
        }
        if (ctx.signal.aborted) return;
        begin(course, features);
      };

      const begin = (course: Course, features: SegFeature[]): void => {
        ctx.shell.setTitle(
          "길안내",
          [
            { label: city.name_ko, href: `#/${cityId}` },
            { label: course.name, href: `#/${cityId}/${course.index}` },
          ],
          `${course.name} 길안내`,
        );
        const cur = currentRoute(cityId, course.index);
        const fallback = course.reachable && course.routes.accessible ? course.routes.accessible : course.routes.shortest;
        const coords: LngLat[] = cur && cur.coords.length > 1 ? cur.coords : fallback.coords;
        const segIds: number[] = cur && cur.coords.length > 1 ? cur.segIds : fallback.seg_ids;
        if (coords.length < 2) {
          ctx.sheet.setContent(errorBlock("안내할 경로가 없어요.", () => ctx.navigate({ name: "course", city: cityId, course: course.index })));
          return;
        }
        const cum = cumulative(coords);
        const total = cum[cum.length - 1];
        const stops = projectStops(coords, cum, course.stops);
        const stopsAlong = stops.map((s) => s.atM);
        const ins: Instruction[] = buildInstructions(coords, segmentSpans(coords, segIds, features), stops);

        touchedMap = true;
        ctx.sheet.setSnap("half");
        showStops(ctx.map, course.stops);
        showRoutes(ctx.map, null, coords);

        // ----- 화면 -----
        const instructionEl = el("p", { class: "nav-instruction", "aria-live": "polite" }, "위치를 확인하는 중");
        const remainEl = el("span", {}, `남은 거리 ${fmtM(total)}`);
        const nextEl = el("span", {}, "");
        const warnEl = el("p", { class: "notice notice-warn nav-warn", "aria-live": "assertive", hidden: "" });
        const promptBox = el("div", { class: "nav-prompt" });
        const controls = el("div", { class: "nav-controls" });
        const root = el(
          "div",
          { class: "nav" },
          instructionEl,
          el("p", { class: "nav-meta" }, remainEl, nextEl),
          warnEl,
          promptBox,
          controls,
        );

        const pill = (label: string, pressed: boolean, onClick: () => void): HTMLButtonElement => {
          const b = el("button", { type: "button", class: "pill", "aria-pressed": String(pressed) }, label);
          b.addEventListener("click", onClick);
          return b as HTMLButtonElement;
        };

        let source: NavSource = typeof navigator !== "undefined" && navigator.geolocation ? "gps" : "sim";
        let speed: 1 | 4 = 1;
        let paused = false;
        let lastAlong = 0;
        let lastText = "";
        let lastWarn = "";
        let warnM = 0;
        let lastRemain = "";
        let lastNext = "";

        const setText = (node: HTMLElement, v: string, prev: string): string => {
          if (v !== prev) node.textContent = v;
          return v;
        };

        const onUpdate = (u: NavUpdate): void => {
          lastAlong = u.progress.alongM;
          const { done, rest } = splitAt(coords, cum, u.progress.alongM);
          showRoutes(ctx.map, null, rest);
          showRouteProgress(ctx.map, done);
          showUser(ctx.map, u.pos, u.heading);
          follow(u.pos);
          lastText = setText(instructionEl, u.text, lastText);
          lastRemain = setText(remainEl, `남은 거리 ${fmtM(u.progress.remainingM)}`, lastRemain);
          const nextStop = course.stops[Math.min(u.progress.nextStopIndex, course.stops.length - 1)];
          const nextName = u.progress.nextStopIndex < course.stops.length && nextStop ? ` · 다음 정류장 ${nextStop.name}` : "";
          lastNext = setText(nextEl, nextName, lastNext);
          // 읽어 주는 영역은 켜질 때·꺼질 때, 거리가 20m 이상 바뀔 때만 갱신한다.
          const offM = Math.round(u.progress.offRouteM);
          const wasOff = lastWarn !== "";
          if (u.offRoute !== wasOff || (u.offRoute && Math.abs(offM - warnM) >= 20)) {
            if (u.offRoute) {
              lastWarn = `경로에서 ${offM}m 벗어났어요`;
              warnM = offM;
              warnEl.textContent = lastWarn;
              warnEl.removeAttribute("hidden");
            } else {
              lastWarn = "";
              warnEl.textContent = "";
              warnEl.setAttribute("hidden", "");
            }
          }
        };

        const follow = (pos: LngLat): void => {
          const m = ctx.map.map;
          const opts = {
            center: pos,
            zoom: Math.max(m.getZoom(), MIN_ZOOM),
            padding: fitPadding(ctx),
          };
          if (prefersReducedMotion()) m.jumpTo(opts);
          else m.easeTo({ ...opts, duration: 300 });
        };

        const start = (): void => {
          stopNav();
          nav = startNav({
            coords,
            source,
            instructions: ins,
            stopsAlongM: stopsAlong,
            startAlongM: lastAlong,
            speed,
            onUpdate,
            onNeedSimulation: (reason) => {
              stopNav();
              showPrompt(reason);
            },
          });
          if (source === "sim" && paused) nav.pause();
        };

        const showPrompt = (reason: "denied" | "unavailable"): void => {
          const useSim = el("button", { type: "button", class: "btn" }, "가상 위치로 보기");
          useSim.addEventListener("click", () => switchSource("sim"));
          promptBox.replaceChildren(
            el(
              "div",
              { class: "notice", role: "note" },
              el("p", {}, reason === "denied" ? "위치 권한이 꺼져 있어요." : "현재 위치를 가져오지 못했어요."),
              el("p", {}, "유럽에 있지 않아도 가상 위치로 길안내를 볼 수 있어요"),
              useSim,
            ),
          );
        };

        const switchSource = (s: NavSource): void => {
          source = s;
          promptBox.replaceChildren();
          paused = false;
          renderControls();
          start();
        };

        const renderControls = (): void => {
          const children: Node[] = [
            el(
              "div",
              { class: "pill-group", role: "group", "aria-label": "위치 방식" },
              pill("내 위치", source === "gps", () => source !== "gps" && switchSource("gps")),
              pill("가상 위치", source === "sim", () => source !== "sim" && switchSource("sim")),
            ),
          ];
          if (source === "sim") {
            const pauseBtn = el("button", { type: "button", class: "pill" }, paused ? "계속" : "일시정지");
            pauseBtn.addEventListener("click", () => {
              paused = !paused;
              if (paused) nav?.pause();
              else nav?.resume();
              pauseBtn.textContent = paused ? "계속" : "일시정지";
            });
            const speedGroup = el(
              "div",
              { class: "pill-group", role: "group", "aria-label": "가상 위치 속도" },
              ...[1, 4].map((v) => {
                const b = pill(`${v}×`, speed === v, () => {
                  speed = v as 1 | 4;
                  nav?.setSpeed(speed);
                  for (const x of speedGroup.querySelectorAll("button")) {
                    x.setAttribute("aria-pressed", String(x.textContent === `${speed}×`));
                  }
                });
                return b;
              }),
            );
            children.push(speedGroup, pauseBtn);
          }
          const end = el("a", { class: "btn btn-quiet", href: `#/${cityId}/${course.index}` }, "길안내 끝내기");
          end.addEventListener("click", (e) => {
            e.preventDefault();
            ctx.navigate({ name: "course", city: cityId, course: course.index });
          });
          children.push(end);
          controls.replaceChildren(...children);
        };

        ctx.sheet.setContent(root);
        renderControls();
        start();
      };

      await loadAll();
    },
    unmount() {
      stopNav();
      inner?.unmount();
      inner = null;
      if (touchedMap && mapRef) {
        showUser(mapRef, null);
        showRouteProgress(mapRef, null);
        showRoutes(mapRef, null, null);
        showStops(mapRef, []);
      }
      touchedMap = false;
    },
  };
}
