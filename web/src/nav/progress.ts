import { distM } from "../core/geo";

type LngLat = [number, number];

export interface Progress {
  alongM: number;
  offRouteM: number;
  remainingM: number;
  nextStopIndex: number;
}

export const OFF_ROUTE_M = 40;
const HINT_BEHIND_M = 25;
const HINT_AHEAD_M = 400;
const RAD = Math.PI / 180;

export function cumulative(coords: LngLat[]): Float64Array {
  const cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + distM(coords[i - 1], coords[i]);
  return cum;
}

interface Hit {
  along: number;
  off: number;
}

/** 같은 거리의 후보 중 hint 앞쪽(가까운 순)을 먼저, 뒤쪽은 그다음으로 본다. */
function rank(along: number, hint: number): number {
  return along >= hint ? along - hint : 1e6 + (hint - along);
}

function scan(coords: LngLat[], cum: Float64Array, p: LngLat, from: number, to: number, hint?: number): Hit {
  const k = Math.cos(p[1] * RAD);
  const R = 6371008.8;
  const px = p[0] * RAD * R * k;
  const py = p[1] * RAD * R;
  let best: Hit = { along: cum[from] ?? 0, off: Infinity };
  for (let i = from; i < to; i++) {
    const ax = coords[i][0] * RAD * R * k;
    const ay = coords[i][1] * RAD * R;
    const bx = coords[i + 1][0] * RAD * R * k;
    const by = coords[i + 1][1] * RAD * R;
    const dx = bx - ax;
    const dy = by - ay;
    const den = dx * dx + dy * dy;
    let t = den === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / den;
    t = Math.min(1, Math.max(0, t));
    const off = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    const along = cum[i] + t * (cum[i + 1] - cum[i]);
    // 왕복 경로처럼 거리가 같은 후보가 여럿이면 직전 위치에 가까운 쪽을 쓴다.
    const tie = hint !== undefined && Math.abs(off - best.off) <= 0.5 && rank(along, hint) < rank(best.along, hint);
    if (off < best.off - (hint !== undefined ? 0.5 : 0) || tie) best = { along, off };
  }
  return best;
}

/**
 * 경로 위 가장 가까운 지점을 찾는다.
 * hintAlongM이 있으면 (hint-25 m ~ hint+400 m)만 본다. 왕복 경로에서 되돌아오는 길이 거꾸로 잡히지 않게 하려는 것이다.
 * 같은 거리의 후보가 여럿이면 hint 앞쪽에서 가장 가까운 것을 쓴다. 힌트 없이 부르면 전체를 본다(처음 위치, 경로 복귀).
 */
export function locate(
  routeCoords: LngLat[],
  cum: Float64Array,
  p: LngLat,
  hintAlongM?: number,
  stopsAlongM?: number[],
): Progress {
  const total = cum.length > 0 ? cum[cum.length - 1] : 0;
  let hit: Hit = { along: 0, off: Infinity };
  if (routeCoords.length === 1) {
    hit = { along: 0, off: distM(p, routeCoords[0]) };
  } else if (routeCoords.length > 1) {
    const n = routeCoords.length - 1;
    if (hintAlongM !== undefined) {
      let lo = 0;
      while (lo < n && cum[lo + 1] < hintAlongM - HINT_BEHIND_M) lo++;
      let hi = lo;
      while (hi < n && cum[hi] <= hintAlongM + HINT_AHEAD_M) hi++;
      hit = scan(routeCoords, cum, p, lo, Math.max(hi, lo + 1 > n ? n : lo + 1), hintAlongM);
    }
    else hit = scan(routeCoords, cum, p, 0, n);
  }
  const along = Math.min(total, Math.max(0, hit.along));
  let next = 0;
  if (stopsAlongM) {
    next = stopsAlongM.findIndex((s) => s > along + 5);
    if (next < 0) next = stopsAlongM.length;
  }
  return { alongM: along, offRouteM: hit.off === Infinity ? 0 : hit.off, remainingM: Math.max(0, total - along), nextStopIndex: next };
}

/** 경로 위 거리 d의 좌표. */
export function pointAt(coords: LngLat[], cum: Float64Array, d: number): LngLat {
  if (coords.length === 0) return [0, 0];
  const total = cum[cum.length - 1];
  if (d <= 0) return coords[0];
  if (d >= total) return coords[coords.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const t = span === 0 ? 0 : (d - cum[lo]) / span;
  return [coords[lo][0] + t * (coords[hi][0] - coords[lo][0]), coords[lo][1] + t * (coords[hi][1] - coords[lo][1])];
}

/** 지난 부분과 남은 부분으로 나눈다. 두 선은 분기점을 공유한다. */
export function splitAt(coords: LngLat[], cum: Float64Array, alongM: number): { done: LngLat[]; rest: LngLat[] } {
  if (coords.length === 0) return { done: [], rest: [] };
  const at = pointAt(coords, cum, alongM);
  const done: LngLat[] = [];
  const rest: LngLat[] = [at];
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] <= alongM) done.push(coords[i]);
    else rest.push(coords[i]);
  }
  done.push(at);
  return { done, rest };
}

export function bearing(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * Math.cos(a[1] * RAD);
  const dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) / RAD) + 360) % 360;
}

/** 경로 위 거리 d에서의 진행 방향(도, 북 = 0, 시계 방향). */
export function headingAt(coords: LngLat[], cum: Float64Array, d: number): number | null {
  if (coords.length < 2) return null;
  const total = cum[cum.length - 1];
  const a = pointAt(coords, cum, Math.max(0, Math.min(d, total - 8)));
  const b = pointAt(coords, cum, Math.min(total, Math.max(d, 0) + 8 > total ? total : Math.max(d, 0) + 8));
  if (a[0] === b[0] && a[1] === b[1]) return null;
  return bearing(a, b);
}

/**
 * 정류장처럼 순서가 있는 점을 경로 위에 투영한다. fromAlongM 이후(−25 m 여유)에서 가장 가까운 지점을 찾는다.
 * 거리가 같으면 앞쪽을 택한다.
 */
export function locateForward(coords: LngLat[], cum: Float64Array, p: LngLat, fromAlongM: number): number {
  if (coords.length < 2) return 0;
  const n = coords.length - 1;
  let lo = 0;
  while (lo < n - 1 && cum[lo + 1] < fromAlongM - HINT_BEHIND_M) lo++;
  const hit = scan(coords, cum, p, lo, n, undefined);
  return Math.max(fromAlongM, hit.along);
}
