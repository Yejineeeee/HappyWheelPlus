import type { Course, GraphJson, PoiKind, RouteMetrics, SegmentProps, Weights } from "../data/types";
import { pathCoords, routeStops, type PathResult } from "./dijkstra";
import { pointLineDistM } from "./geo";
import { buildGraph, snapStops, type Graph } from "./graph";
import { routeMetrics } from "./metrics";
import { routeProfile } from "./profile";
import { scoreEdge } from "./scoring";

export interface Conditions {
  weights: Weights;
  requiredPois: PoiKind[];
}

export interface CustomResult {
  path: PathResult;
  coords: [number, number][];
  metrics: RouteMetrics;
  profile: [number, number | null, number | null][];
  /** 경로 300m 안에 하나도 없는 필수 종류 */
  missingPois: PoiKind[];
  /** 구간(seg_id)별 점수. 통과 불가는 NaN. */
  segScores: Float32Array;
}

export interface ComputeCtx {
  graph: Graph;
  segs: SegmentProps[];
  segCoords: (id: number) => [number, number][];
  pois: { kind: PoiKind; lon: number; lat: number }[];
  alpha: number;
}

export const NEAR_POI_M = 300;
const EPS = 1e-9;

export function isDefault(c: Conditions, d: Weights): boolean {
  const w = c.weights;
  return (
    c.requiredPois.length === 0 &&
    Math.abs(w.slope - d.slope) < EPS &&
    Math.abs(w.surface - d.surface) < EPS &&
    Math.abs(w.kerb - d.kerb) < EPS &&
    Math.abs(w.uncertainty - d.uncertainty) < EPS
  );
}

function missingKinds(required: PoiKind[], pois: ComputeCtx["pois"], line: [number, number][]): PoiKind[] {
  if (required.length === 0) return [];
  if (line.length === 0) return [...required];
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of line) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  const dLat = NEAR_POI_M / 111320;
  const dLon = NEAR_POI_M / (111320 * Math.max(0.01, Math.cos((((s + n) / 2) * Math.PI) / 180)));
  const found = new Set<PoiKind>();
  for (const p of pois) {
    if (!required.includes(p.kind) || found.has(p.kind)) continue;
    if (p.lon < w - dLon || p.lon > e + dLon || p.lat < s - dLat || p.lat > n + dLat) continue;
    if (pointLineDistM([p.lon, p.lat], line) <= NEAR_POI_M) found.add(p.kind);
  }
  return required.filter((k) => !found.has(k));
}

export function computeCustom(ctx: ComputeCtx, course: Course, c: Conditions): CustomResult {
  const { graph, segs } = ctx;
  const stops = course.stops.map((s) => [s.lon, s.lat] as [number, number]);
  const snapped = snapStops(graph, stops).nodes;
  const path = routeStops(graph, snapped, c.weights, ctx.alpha, "accessible");
  const coords = path.reachable ? pathCoords(graph, ctx.segCoords, path) : [];
  const props = (id: number): SegmentProps => segs[id];
  const toilets = ctx.pois.filter((p) => p.kind === "toilet").map((p) => [p.lon, p.lat] as [number, number]);
  const metrics = routeMetrics(path, props, coords, toilets, c.weights);
  const profile = routeProfile(graph, path, props);

  const E = graph.len.length;
  const segScores = new Float32Array(E);
  for (let e = 0; e < E; e++) {
    const s = scoreEdge(
      {
        p_slope: graph.pen[4 * e],
        p_surface: graph.pen[4 * e + 1],
        p_kerb: graph.pen[4 * e + 2],
        p_unc: graph.pen[4 * e + 3],
      },
      graph.flags[e],
      c.weights,
    );
    segScores[e] = s === null ? NaN : s;
  }
  const missingPois = path.reachable ? missingKinds(c.requiredPois, ctx.pois, coords) : [...c.requiredPois];
  return { path, coords, metrics, profile, missingPois, segScores };
}

// ---------- 도시별 그래프 캐시 ----------

const graphCache = new Map<string, Graph>();

/** 도시·data_version 별로 그래프를 한 번만 만든다. */
export function cachedGraph(cityId: string, version: string, gj: GraphJson): Graph {
  const key = `${cityId}@${version}`;
  let g = graphCache.get(key);
  if (!g) {
    g = buildGraph(gj);
    graphCache.set(key, g);
  }
  return g;
}

export function clearGraphCache(): void {
  graphCache.clear();
  propsCache.clear();
}

const propsCache = new Map<string, SegmentProps[]>();

/** 구간 속성 배열(인덱스 = seg_id)을 도시·data_version 별로 한 번만 만든다. */
export function cachedSegProps(cityId: string, version: string, features: { properties: SegmentProps }[]): SegmentProps[] {
  const key = `${cityId}@${version}`;
  let p = propsCache.get(key);
  if (!p) {
    p = features.map((f) => f.properties);
    propsCache.set(key, p);
  }
  return p;
}

// ---------- 현재 경로 저장소 (길안내가 읽는다) ----------

export interface CurrentRoute {
  coords: [number, number][];
  segIds: number[];
  source: "default" | "custom";
}

const current = new Map<string, CurrentRoute>();

export function setCurrentRoute(city: string, course: number, r: CurrentRoute): void {
  current.set(`${city}/${course}`, r);
}

export function currentRoute(city: string, course: number): CurrentRoute | null {
  return current.get(`${city}/${course}`) ?? null;
}
