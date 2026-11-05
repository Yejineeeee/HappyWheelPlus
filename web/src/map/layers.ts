import maplibregl from "maplibre-gl";
import { Armchair, ArrowUpDown, Bath, Droplet } from "lucide";
import type { CityEntry, PoiKind } from "../data/types";
import type { AppMap } from "./map";
import { prefersReducedMotion } from "./map";
import {
  POI_PIXEL_RATIO,
  poiCanvasSize,
  scoreColor,
  scoreColorExpression,
  segmentAnchor,
  type StyleLayerInfo,
} from "./style";

type LngLat = [number, number];
type Stop = { name: string; lon: number; lat: number };
export type RouteFocus = "shortest" | "accessible";

interface State {
  segments: GeoJSON.FeatureCollection | null;
  pois: GeoJSON.FeatureCollection | null;
  visible: Record<PoiKind, boolean> | null;
  routes: { shortest: LngLat[] | null; accessible: LngLat[] | null; baseline: LngLat[] | null } | null;
  done: LngLat[] | null;
  /** 지도에서 강조할 경로. 나머지는 흐리게 그린다. */
  focus: RouteFocus;
  cityMarkers: maplibregl.Marker[];
  cityMarkerById: Map<string, maplibregl.Marker>;
  cityDeclutter: (() => void) | null;
  stopMarkers: maplibregl.Marker[];
  userMarker: maplibregl.Marker | null;
  blockedMarker: maplibregl.Marker | null;
  poiHandlersBound: boolean;
  popup: maplibregl.Popup | null;
}

const states = new WeakMap<AppMap, State>();

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#000000";
}

function getState(m: AppMap): State {
  let s = states.get(m);
  if (!s) {
    s = {
      segments: null,
      pois: null,
      visible: null,
      routes: null,
      done: null,
      focus: "accessible",
      cityMarkers: [],
      cityMarkerById: new Map(),
      cityDeclutter: null,
      stopMarkers: [],
      userMarker: null,
      blockedMarker: null,
      poiHandlersBound: false,
      popup: null,
    };
    states.set(m, s);
    m.onStyleLoad(() => applyAll(m));
  }
  return s;
}

function styleReady(m: AppMap): boolean {
  return m.isReady();
}

/** 스타일이 새로 올라올 때 저장해 둔 데이터를 순서대로 다시 올린다. */
function applyAll(m: AppMap): void {
  const s = getState(m);
  applySegments(m, s);
  applyPois(m, s);
  applyRoutes(m, s);
}

function setSource(map: maplibregl.Map, id: string, data: GeoJSON.GeoJSON): void {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

const LAYER_ORDER = [
  "segments-scored",
  "segments-blocked",
  "pois-hit-minor",
  "pois-hit",
  "pois-minor",
  "pois",
  "route-short",
  "route-base",
  "route-casing",
  "route-done",
  "route-acc",
];

/**
 * 구간 히트맵은 기본 지도의 도로 선 위·글자 아래(segmentAnchor), 앱의 편의시설·경로 레이어 아래에 둔다.
 * 편의시설·경로는 LAYER_ORDER 순서(아래→위)가 유지되도록 이미 있는 더 위 레이어 바로 앞에 끼워 넣는다.
 */
function addOrdered(map: maplibregl.Map, layer: maplibregl.LayerSpecification): void {
  const pos = LAYER_ORDER.indexOf(layer.id);
  const upperApp = LAYER_ORDER.slice(pos + 1).find((id) => map.getLayer(id));
  let before = upperApp;
  if (layer.id.startsWith("segments-")) {
    const base = map.getStyle().layers.filter((l) => !LAYER_ORDER.includes(l.id));
    before = segmentAnchor(base as StyleLayerInfo[]) ?? upperApp;
  }
  map.addLayer(layer, before);
}

function removeLayers(map: maplibregl.Map, layers: string[], sources: string[]): void {
  for (const l of layers) if (map.getLayer(l)) map.removeLayer(l);
  for (const s of sources) if (map.getSource(s)) map.removeSource(s);
}

// ---------- 도시 마커 ----------

function stopDeclutter(m: AppMap, s: State): void {
  if (s.cityDeclutter) {
    m.map.off("moveend", s.cityDeclutter);
    m.map.off("resize", s.cityDeclutter);
  }
  s.cityDeclutter = null;
}

export function showCityMarkers(m: AppMap, cities: CityEntry[], onSelect: (id: string) => void): void {
  const s = getState(m);
  stopDeclutter(m, s);
  for (const mk of s.cityMarkers) mk.remove();
  const sorted = [...cities].sort((a, b) => b.metrics.mean_score - a.metrics.mean_score);
  const labels: HTMLElement[] = [];
  const byId = new Map<string, maplibregl.Marker>();
  for (const c of sorted) {
    const score = Math.round(c.metrics.mean_score);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "city-marker";
    btn.setAttribute("aria-label", `${c.name_ko} ${score}점`);
    const dot = document.createElement("span");
    dot.className = "city-dot";
    dot.setAttribute("aria-hidden", "true");
    dot.style.background = scoreColor(c.metrics.mean_score);
    const label = document.createElement("span");
    label.className = "city-label";
    label.setAttribute("aria-hidden", "true");
    label.textContent = `${c.name_ko} ${score}`;
    // 숨겨진 라벨이 클릭을 가로채지 않도록 버튼 자체는 클릭을 받지 않고, 점과 보이는 라벨만 받는다.
    btn.style.pointerEvents = "none";
    dot.style.pointerEvents = "auto";
    label.style.pointerEvents = "auto";
    btn.append(dot, label);
    labels.push(label);
    btn.addEventListener("click", () => onSelect(c.id));
    // 점 중심이 도시 좌표에 오도록 왼쪽 기준으로 놓는다(왼쪽 여백 14 + 점 반지름 8).
    byId.set(
      c.id,
      new maplibregl.Marker({ element: btn, anchor: "left", offset: [-22, 0] }).setLngLat(c.center).addTo(m.map),
    );
  }
  s.cityMarkers = [...byId.values()];
  s.cityMarkerById = byId;

  // 점수가 높은 도시부터 라벨을 남기고, 먼저 남긴 라벨과 겹치는 라벨은 숨긴다. 점은 항상 보인다.
  const declutter = () => {
    for (const l of labels) l.style.display = "";
    const kept: DOMRect[] = [];
    for (const l of labels) {
      const r = l.getBoundingClientRect();
      if (kept.some((k) => r.left < k.right && r.right > k.left && r.top < k.bottom && r.bottom > k.top)) {
        l.style.display = "none";
      } else {
        kept.push(r);
      }
    }
  };
  s.cityDeclutter = declutter;
  m.map.on("moveend", declutter);
  m.map.on("resize", declutter);
  requestAnimationFrame(declutter);
}

/** 도시 마커 하나를 강조한다(비교 화면 막대와 연결). null이면 강조를 모두 끈다. */
export function highlightCityMarker(m: AppMap, id: string | null): void {
  const s = getState(m);
  for (const [cid, mk] of s.cityMarkerById) {
    mk.getElement().classList.toggle("is-highlight", cid === id);
  }
}

// ---------- 구간 히트맵 ----------

function applySegments(m: AppMap, s: State): void {
  const map = m.map;
  if (!s.segments || !styleReady(m)) return;
  setSource(map, "segments", s.segments);
  const width: maplibregl.ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 12, 1.5, 17, 4];
  if (!map.getLayer("segments-scored")) {
    addOrdered(map,
      {
        id: "segments-scored",
        type: "line",
        source: "segments",
        filter: ["==", ["get", "b"], false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": scoreColorExpression(css("--muted")), "line-width": width, "line-opacity": 0.9 },
      });
  }
  if (map.getLayer("segments-blocked")) map.removeLayer("segments-blocked");
  addOrdered(map,
    {
      id: "segments-blocked",
      type: "line",
      source: "segments",
      filter: ["==", ["get", "b"], true],
      layout: { "line-join": "round" },
      paint: { "line-color": css("--blocked"), "line-width": width, "line-dasharray": [1.5, 1.5] },
    });
}

/** 히트맵 데이터가 이미 올라와 있는지. */
export function hasSegments(m: AppMap): boolean {
  return getState(m).segments !== null;
}

export function showSegments(m: AppMap, fc: GeoJSON.FeatureCollection, scores: Float32Array | null): void {
  const s = getState(m);
  const features = fc.features.map((f, i) => {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const fid = typeof f.id === "number" ? f.id : i;
    const base = typeof p.score === "number" ? p.score : null;
    const sc = scores ? scores[fid] : base;
    const blocked = p.blocked === true;
    return {
      ...f,
      properties: { ...p, s: sc !== null && sc !== undefined && Number.isFinite(sc) ? sc : -1, b: blocked },
    };
  });
  s.segments = { ...fc, features };
  applySegments(m, s);
}

// ---------- 편의시설 ----------

type IconNode = [string, Record<string, string | number>][];

const POI_KINDS: PoiKind[] = ["toilet", "elevator", "bench", "fountain"];
const POI_LABEL: Record<PoiKind, string> = {
  toilet: "화장실",
  elevator: "엘리베이터",
  bench: "벤치",
  fountain: "음수대",
};
// 흰 글리프 대비 AA 이상
const POI_COLOR: Record<PoiKind, string> = {
  toilet: "#1f5fd1",
  elevator: "#6b3fa0",
  bench: "#9a5b00",
  fountain: "#0e7490",
};
const POI_ICON: Record<PoiKind, IconNode> = {
  toilet: Bath as unknown as IconNode,
  elevator: ArrowUpDown as unknown as IconNode,
  bench: Armchair as unknown as IconNode,
  fountain: Droplet as unknown as IconNode,
};
const WHEELCHAIR_LABEL: Record<string, string> = { yes: "휠체어 가능", limited: "일부 가능", no: "불가" };

let iconPromise: Promise<Record<PoiKind, ImageData>> | null = null;

function renderIcon(kind: PoiKind): Promise<ImageData> {
  const size = poiCanvasSize();
  const inner = POI_ICON[kind]
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">` +
    `<circle cx="24" cy="24" r="22" fill="${POI_COLOR[kind]}" stroke="#ffffff" stroke-width="2"/>` +
    `<g transform="translate(12 12)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `${inner}</g></svg>`;
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, size, size);
      resolve(ctx.getImageData(0, 0, size, size));
    };
    img.onerror = () => reject(new Error(`icon ${kind}`));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function loadIcons(): Promise<Record<PoiKind, ImageData>> {
  iconPromise ??= Promise.all(POI_KINDS.map(renderIcon)).then(
    (imgs) => Object.fromEntries(POI_KINDS.map((k, i) => [k, imgs[i]])) as Record<PoiKind, ImageData>,
  );
  return iconPromise;
}

/** 자주 쓰는 종류는 14 이상, 많은 벤치·음수대는 15 이상에서만 보인다. 겹치는 아이콘은 숨긴다. */
const POI_GROUPS: { suffix: string; kinds: PoiKind[]; minzoom: number }[] = [
  { suffix: "", kinds: ["toilet", "elevator"], minzoom: 14 },
  { suffix: "-minor", kinds: ["bench", "fountain"], minzoom: 15 },
];

function groupFilter(s: State, kinds: PoiKind[]): maplibregl.FilterSpecification {
  const on = kinds.filter((k) => (s.visible ? s.visible[k] : true));
  return ["in", ["get", "kind"], ["literal", on]];
}

function applyPoiFilters(m: AppMap, s: State): void {
  const map = m.map;
  for (const g of POI_GROUPS) {
    const f = groupFilter(s, g.kinds);
    for (const id of [`pois${g.suffix}`, `pois-hit${g.suffix}`]) if (map.getLayer(id)) map.setFilter(id, f);
  }
  map.triggerRepaint();
}

function applyPois(m: AppMap, s: State): void {
  const map = m.map;
  if (!s.pois || !styleReady(m)) return;
  const data = s.pois;
  void loadIcons().then((icons) => {
    if (!styleReady(m) || s.pois !== data) return;
    for (const k of POI_KINDS) {
      const name = `poi-${k}`;
      if (!map.hasImage(name)) map.addImage(name, icons[k], { pixelRatio: POI_PIXEL_RATIO });
    }
    setSource(map, "pois", data);
    // 지도 위 편의시설 상세는 키보드로 열 수 없다. 같은 정보는 시트의 편의시설 목록(화면 6·7)에서 키보드로 접근한다.
    for (const g of POI_GROUPS) {
      const hitId = `pois-hit${g.suffix}`;
      const id = `pois${g.suffix}`;
      if (!map.getLayer(hitId)) {
        addOrdered(map, {
          id: hitId,
          type: "circle",
          source: "pois",
          minzoom: g.minzoom,
          paint: { "circle-radius": 22, "circle-opacity": 0 },
        });
      }
      if (!map.getLayer(id)) {
        addOrdered(map, {
          id,
          type: "symbol",
          source: "pois",
          minzoom: g.minzoom,
          layout: {
            "icon-image": ["concat", "poi-", ["get", "kind"]],
            "icon-allow-overlap": false,
            "icon-ignore-placement": false,
            "icon-size": 1,
          },
        });
      }
    }
    applyPoiFilters(m, s);
    bindPoiHandlers(m, s);
  });
}

function bindPoiHandlers(m: AppMap, s: State): void {
  if (s.poiHandlersBound) return;
  s.poiHandlersBound = true;
  const map = m.map;
  for (const g of POI_GROUPS) {
    const hit = `pois-hit${g.suffix}`;
    map.on("mouseenter", hit, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", hit, () => (map.getCanvas().style.cursor = ""));
    map.on("click", hit, (e) => openPoiPopup(map, s, e));
  }
}

function openPoiPopup(
  map: maplibregl.Map,
  s: State,
  e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
): void {
  {
    const f = e.features?.[0];
    if (!f || f.geometry.type !== "Point") return;
    const p = f.properties as { kind: PoiKind; name?: string | null; wheelchair?: string | null };
    const box = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = p.name || POI_LABEL[p.kind];
    box.appendChild(title);
    const wc = p.wheelchair ? WHEELCHAIR_LABEL[p.wheelchair] : undefined;
    if (wc) {
      const row = document.createElement("div");
      row.textContent = wc;
      box.appendChild(row);
    }
    s.popup?.remove();
    s.popup = new maplibregl.Popup({ offset: 14 })
      .setLngLat(f.geometry.coordinates as LngLat)
      .setDOMContent(box)
      .addTo(map);
  }
}

export function showPois(m: AppMap, fc: GeoJSON.FeatureCollection, visible: Record<PoiKind, boolean>): void {
  const s = getState(m);
  s.pois = fc;
  s.visible = { ...visible };
  if (m.isReady() && m.map.getLayer("pois") && m.map.getSource("pois")) {
    setSource(m.map, "pois", fc);
    applyPoiFilters(m, s);
    return;
  }
  applyPois(m, s);
}

// ---------- 경로 ----------

function line(coords: LngLat[] | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      coords && coords.length > 1
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }]
        : [],
  };
}

function applyRoutes(m: AppMap, s: State): void {
  const map = m.map;
  if (!s.routes || !styleReady(m)) return;
  setSource(map, "route-short", line(s.routes.shortest));
  setSource(map, "route-acc", line(s.routes.accessible));
  setSource(map, "route-base", line(s.routes.baseline));
  setSource(map, "route-done", line(s.done));
  const round = { "line-cap": "round", "line-join": "round" } as const;
  const shortFocus = s.focus === "shortest";
  const dim = shortFocus ? 0.3 : 1;
  for (const id of ["route-short", "route-base", "route-casing", "route-done", "route-acc"]) if (map.getLayer(id)) map.removeLayer(id);
  addOrdered(map, {
    id: "route-short",
    type: "line",
    source: "route-short",
    layout: { "line-join": "round" },
    paint: {
      "line-color": css("--route-short"),
      "line-width": shortFocus ? 5 : 3,
      "line-opacity": shortFocus ? 1 : 0.9,
      "line-dasharray": [2, 2],
    },
  });
  addOrdered(map, {
    id: "route-base",
    type: "line",
    source: "route-base",
    layout: round,
    paint: { "line-color": css("--route-short"), "line-width": 2, "line-opacity": 0.9 * dim },
  });
  addOrdered(map, {
    id: "route-casing",
    type: "line",
    source: "route-acc",
    layout: round,
    paint: { "line-color": css("--surface"), "line-width": 8, "line-opacity": dim },
  });
  addOrdered(map, {
    id: "route-done",
    type: "line",
    source: "route-done",
    layout: round,
    paint: { "line-color": css("--route-short"), "line-width": 5, "line-opacity": 0.55 },
  });
  addOrdered(map, {
    id: "route-acc",
    type: "line",
    source: "route-acc",
    layout: round,
    paint: { "line-color": css("--route-acc"), "line-width": 5, "line-opacity": dim },
  });
}

/** baseline: 내 조건 경로를 그릴 때 기본 접근성 경로를 얇은 회색 실선으로 함께 보여 준다. */
export function showRoutes(
  m: AppMap,
  shortest: LngLat[] | null,
  accessible: LngLat[] | null,
  opts: { baseline?: LngLat[] | null } = {},
): void {
  const s = getState(m);
  s.routes = { shortest, accessible, baseline: opts.baseline ?? null };
  applyRoutes(m, s);
}

/** 코스 상세의 경로 보기 전환: 강조할 경로를 고르고 나머지는 흐리게 그린다. */
export function setRouteFocus(m: AppMap, focus: RouteFocus): void {
  const s = getState(m);
  if (s.focus === focus) return;
  s.focus = focus;
  applyRoutes(m, s);
}

/** 길안내에서 이미 지난 구간을 흐리게 그린다. null이면 지운다. */
export function showRouteProgress(m: AppMap, done: LngLat[] | null): void {
  const s = getState(m);
  s.done = done;
  applyRoutes(m, s);
}

// ---------- 정류장 ----------

export function showStops(m: AppMap, stops: Stop[]): void {
  const s = getState(m);
  for (const mk of s.stopMarkers) mk.remove();
  s.stopMarkers = stops.map((st, i) => {
    const el = document.createElement("div");
    el.className = "stop-marker";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", `정류장 ${i + 1}: ${st.name}`);
    el.textContent = String(i + 1);
    el.style.cssText =
      "width:28px;height:28px;border-radius:50%;box-sizing:border-box;display:flex;align-items:center;" +
      "justify-content:center;background:var(--surface);color:var(--ink);border:2px solid var(--route-acc);" +
      "font:700 13px/1 var(--font);font-variant-numeric:tabular-nums;";
    return new maplibregl.Marker({ element: el }).setLngLat([st.lon, st.lat]).addTo(m.map);
  });
}

/** 휠체어로 막힌 지점 표시. pos가 null이면 지운다. */
export function showBlockedAt(m: AppMap, pos: LngLat | null): void {
  const s = getState(m);
  s.blockedMarker?.remove();
  s.blockedMarker = null;
  if (!pos) return;
  const el = document.createElement("div");
  el.className = "blocked-marker";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "막힌 지점");
  el.textContent = "✕";
  el.style.cssText =
    "width:28px;height:28px;border-radius:50%;box-sizing:border-box;display:flex;align-items:center;" +
    "justify-content:center;background:var(--surface);color:var(--blocked);border:2px dashed var(--blocked);" +
    "font:700 14px/1 var(--font);";
  s.blockedMarker = new maplibregl.Marker({ element: el }).setLngLat(pos).addTo(m.map);
}

// ---------- 사용자 위치 ----------

export function showUser(m: AppMap, pos: LngLat | null, heading?: number | null): void {
  const s = getState(m);
  if (!pos) {
    s.userMarker?.remove();
    s.userMarker = null;
    return;
  }
  if (!s.userMarker) {
    const el = document.createElement("div");
    el.className = "user-marker";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "현재 위치");
    el.style.cssText = "width:18px;height:18px;";
    const arrow = document.createElement("span");
    arrow.dataset.role = "arrow";
    arrow.style.cssText =
      "position:absolute;left:50%;top:-8px;margin-left:-6px;border:6px solid transparent;" +
      "border-bottom:9px solid var(--route-acc);border-top:0;display:none";
    const dot = document.createElement("span");
    dot.style.cssText =
      "display:block;width:18px;height:18px;border-radius:50%;background:var(--route-acc);" +
      "border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3);box-sizing:border-box";
    el.append(arrow, dot);
    s.userMarker = new maplibregl.Marker({ element: el, rotationAlignment: "map" }).setLngLat(pos).addTo(m.map);
  }
  s.userMarker.setLngLat(pos);
  const arrowEl = s.userMarker.getElement().querySelector<HTMLElement>('[data-role="arrow"]')!;
  const hasHeading = typeof heading === "number" && Number.isFinite(heading);
  arrowEl.style.display = hasHeading ? "block" : "none";
  s.userMarker.setRotation(hasHeading ? heading : 0);
}

// ---------- 정리 ----------

export function clearCityLayers(m: AppMap): void {
  const s = getState(m);
  s.segments = null;
  s.pois = null;
  s.routes = null;
  s.done = null;
  s.focus = "accessible";
  for (const mk of s.cityMarkers) mk.remove();
  for (const mk of s.stopMarkers) mk.remove();
  stopDeclutter(m, s);
  s.userMarker?.remove();
  s.blockedMarker?.remove();
  s.blockedMarker = null;
  s.popup?.remove();
  s.popup = null;
  s.cityMarkers = [];
  s.cityMarkerById = new Map();
  s.stopMarkers = [];
  s.userMarker = null;
  if (styleReady(m)) {
    removeLayers(
      m.map,
      ["segments-scored", "segments-blocked", "pois-hit-minor", "pois-hit", "pois-minor", "pois", "route-acc", "route-done", "route-casing", "route-base", "route-short"],
      ["segments", "pois", "route-short", "route-acc", "route-base", "route-done"],
    );
  }
}

export { prefersReducedMotion };
