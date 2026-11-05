import maplibregl from "maplibre-gl";
import { Armchair, ArrowUpDown, Bath, Droplet } from "lucide";
import type { CityEntry, PoiKind } from "../data/types";
import type { AppMap } from "./map";
import { prefersReducedMotion } from "./map";
import { scoreColor, scoreColorExpression } from "./style";

type LngLat = [number, number];
type Stop = { name: string; lon: number; lat: number };

interface State {
  segments: GeoJSON.FeatureCollection | null;
  pois: GeoJSON.FeatureCollection | null;
  visible: Record<PoiKind, boolean> | null;
  routes: { shortest: LngLat[] | null; accessible: LngLat[] | null } | null;
  cityMarkers: maplibregl.Marker[];
  stopMarkers: maplibregl.Marker[];
  userMarker: maplibregl.Marker | null;
  poiHandlersBound: boolean;
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
      cityMarkers: [],
      stopMarkers: [],
      userMarker: null,
      poiHandlersBound: false,
    };
    states.set(m, s);
    m.onStyleLoad(() => applyAll(m));
  }
  return s;
}

function styleReady(m: AppMap): boolean {
  return m.map.isStyleLoaded() === true;
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

function removeLayers(map: maplibregl.Map, layers: string[], sources: string[]): void {
  for (const l of layers) if (map.getLayer(l)) map.removeLayer(l);
  for (const s of sources) if (map.getSource(s)) map.removeSource(s);
}

// ---------- 도시 마커 ----------

export function showCityMarkers(m: AppMap, cities: CityEntry[], onSelect: (id: string) => void): void {
  const s = getState(m);
  for (const mk of s.cityMarkers) mk.remove();
  s.cityMarkers = cities.map((c) => {
    const score = Math.round(c.metrics.mean_score);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "city-marker";
    btn.textContent = `${c.name_ko} ${score}`;
    // 어두운 구간(0~55)은 흰 글자, 밝은 구간은 검은 글자
    const text = c.metrics.mean_score < 55 ? "#ffffff" : "#000000";
    btn.style.cssText =
      `background:${scoreColor(c.metrics.mean_score)};color:${text};` +
      "border:2px solid #fff;border-radius:22px;min-height:44px;min-width:44px;padding:0 14px;" +
      "font:600 14px/1 var(--font);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.35);font-variant-numeric:tabular-nums;";
    btn.addEventListener("click", () => onSelect(c.id));
    return new maplibregl.Marker({ element: btn }).setLngLat(c.center).addTo(m.map);
  });
}

// ---------- 구간 히트맵 ----------

function applySegments(m: AppMap, s: State): void {
  const map = m.map;
  if (!s.segments || !styleReady(m)) return;
  setSource(map, "segments", s.segments);
  const before = map.getLayer("route-short") ? "route-short" : undefined;
  const width: maplibregl.ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 12, 1.5, 17, 4];
  if (!map.getLayer("segments-scored")) {
    map.addLayer(
      {
        id: "segments-scored",
        type: "line",
        source: "segments",
        filter: ["==", ["get", "b"], false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": scoreColorExpression(), "line-width": width, "line-opacity": 0.9 },
      },
      before,
    );
  }
  if (map.getLayer("segments-blocked")) map.removeLayer("segments-blocked");
  map.addLayer(
    {
      id: "segments-blocked",
      type: "line",
      source: "segments",
      filter: ["==", ["get", "b"], true],
      layout: { "line-join": "round" },
      paint: { "line-color": css("--blocked"), "line-width": width, "line-dasharray": [1.5, 1.5] },
    },
    before,
  );
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
      properties: { ...p, s: sc !== null && Number.isFinite(sc) ? sc : 0, b: blocked },
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
  const size = 48;
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

function visibleKinds(s: State): PoiKind[] {
  return POI_KINDS.filter((k) => (s.visible ? s.visible[k] : true));
}

function applyPois(m: AppMap, s: State): void {
  const map = m.map;
  if (!s.pois || !styleReady(m)) return;
  const data = s.pois;
  void loadIcons().then((icons) => {
    if (!styleReady(m) || s.pois !== data) return;
    for (const k of POI_KINDS) {
      const name = `poi-${k}`;
      if (!map.hasImage(name)) map.addImage(name, icons[k], { pixelRatio: 2 });
    }
    setSource(map, "pois", data);
    if (!map.getLayer("pois")) {
      map.addLayer({
        id: "pois",
        type: "symbol",
        source: "pois",
        layout: {
          "icon-image": ["concat", "poi-", ["get", "kind"]],
          "icon-allow-overlap": true,
          "icon-size": 0.75,
        },
      });
    }
    map.setFilter("pois", ["in", ["get", "kind"], ["literal", visibleKinds(s)]]);
    bindPoiHandlers(m, s);
  });
}

function bindPoiHandlers(m: AppMap, s: State): void {
  if (s.poiHandlersBound) return;
  s.poiHandlersBound = true;
  const map = m.map;
  map.on("mouseenter", "pois", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "pois", () => (map.getCanvas().style.cursor = ""));
  map.on("click", "pois", (e) => {
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
    new maplibregl.Popup({ offset: 14 })
      .setLngLat(f.geometry.coordinates as LngLat)
      .setDOMContent(box)
      .addTo(map);
  });
}

export function showPois(m: AppMap, fc: GeoJSON.FeatureCollection, visible: Record<PoiKind, boolean>): void {
  const s = getState(m);
  s.pois = fc;
  s.visible = visible;
  if (m.map.getLayer("pois") && m.map.getSource("pois")) {
    setSource(m.map, "pois", fc);
    m.map.setFilter("pois", ["in", ["get", "kind"], ["literal", visibleKinds(s)]]);
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
  const round = { "line-cap": "round", "line-join": "round" } as const;
  for (const id of ["route-short", "route-casing", "route-acc"]) if (map.getLayer(id)) map.removeLayer(id);
  map.addLayer({
    id: "route-short",
    type: "line",
    source: "route-short",
    layout: { "line-join": "round" },
    paint: { "line-color": css("--route-short"), "line-width": 3, "line-dasharray": [2, 2] },
  });
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route-acc",
    layout: round,
    paint: { "line-color": css("--surface"), "line-width": 7 },
  });
  map.addLayer({
    id: "route-acc",
    type: "line",
    source: "route-acc",
    layout: round,
    paint: { "line-color": css("--accent"), "line-width": 5 },
  });
}

export function showRoutes(m: AppMap, shortest: LngLat[] | null, accessible: LngLat[] | null): void {
  const s = getState(m);
  s.routes = { shortest, accessible };
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
      "justify-content:center;background:var(--surface);color:var(--ink);border:2px solid var(--accent);" +
      "font:700 13px/1 var(--font);font-variant-numeric:tabular-nums;";
    return new maplibregl.Marker({ element: el }).setLngLat([st.lon, st.lat]).addTo(m.map);
  });
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
    el.style.cssText = "position:relative;width:18px;height:18px;";
    const arrow = document.createElement("span");
    arrow.dataset.role = "arrow";
    arrow.style.cssText =
      "position:absolute;left:50%;top:-8px;margin-left:-6px;border:6px solid transparent;" +
      "border-bottom:9px solid var(--accent);border-top:0;display:none";
    const dot = document.createElement("span");
    dot.style.cssText =
      "display:block;width:18px;height:18px;border-radius:50%;background:var(--accent);" +
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
  for (const mk of s.cityMarkers) mk.remove();
  for (const mk of s.stopMarkers) mk.remove();
  s.userMarker?.remove();
  s.cityMarkers = [];
  s.stopMarkers = [];
  s.userMarker = null;
  if (styleReady(m)) {
    removeLayers(
      m.map,
      ["segments-scored", "segments-blocked", "pois", "route-acc", "route-casing", "route-short"],
      ["segments", "pois", "route-short", "route-acc"],
    );
  }
}

export { prefersReducedMotion };
