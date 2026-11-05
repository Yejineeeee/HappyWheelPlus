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

const RE = 6371008.8;
const BACK_PENALTY = 1;
// 이동 거리 항의 폭. 급커브에서는 경로상 이동 거리가 직선 거리보다 커지므로 정확도의 2배로 넉넉하게 둔다.
const TAU_K = 2;

/** 전체 경로에서 거리만으로 가장 가까운 지점을 찾는다. */
function scan(coords: LngLat[], cum: Float64Array, p: LngLat, from: number, to: number): Hit {
  const k = Math.cos(p[1] * RAD);
  const px = p[0] * RAD * RE * k;
  const py = p[1] * RAD * RE;
  let best: Hit = { along: cum[from] ?? 0, off: Infinity };
  for (let i = from; i < to; i++) {
    const ax = coords[i][0] * RAD * RE * k;
    const ay = coords[i][1] * RAD * RE;
    const dx = coords[i + 1][0] * RAD * RE * k - ax;
    const dy = coords[i + 1][1] * RAD * RE - ay;
    const den = dx * dx + dy * dy;
    let t = den === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / den;
    t = Math.min(1, Math.max(0, t));
    const off = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    if (off < best.off) best = { along: cum[i] + t * (cum[i + 1] - cum[i]), off };
  }
  return best;
}

/**
 * 직전 위치(prevAlong) 근처에서 이동 거리와 맞는 지점을 찾는다.
 * 창 [prev-W, prev+W], W = 이동 거리 + 3×정확도 + 30 m 안의 구간마다 투영해 후보를 만들고,
 * 점수 = (경로까지 거리/σ)² + ((|Δalong| − 이동 거리)/τ)² 가 가장 작은 후보를 쓴다(σ = max(정확도, 5), τ = 2×max(정확도, 10)).
 */
function matchStep(
  coords: LngLat[],
  cum: Float64Array,
  p: LngLat,
  prevAlong: number,
  displacementM: number,
  accuracyM: number,
): Hit {
  const total = cum[cum.length - 1];
  const W = displacementM + 3 * accuracyM + 30;
  const lo = Math.max(0, prevAlong - W);
  const hi = Math.min(total, prevAlong + W);
  const sigma = Math.max(accuracyM, 5);
  const tau = TAU_K * Math.max(accuracyM, 10);
  const k = Math.cos(p[1] * RAD);
  const px = p[0] * RAD * RE * k;
  const py = p[1] * RAD * RE;
  let best: Hit = { along: Math.min(hi, Math.max(lo, prevAlong)), off: Infinity };
  let bestScore = Infinity;
  for (let i = 0; i + 1 < coords.length; i++) {
    const len = cum[i + 1] - cum[i];
    if (len <= 0 || cum[i + 1] < lo || cum[i] > hi) continue;
    const ax = coords[i][0] * RAD * RE * k;
    const ay = coords[i][1] * RAD * RE;
    const dx = coords[i + 1][0] * RAD * RE * k - ax;
    const dy = coords[i + 1][1] * RAD * RE - ay;
    const den = dx * dx + dy * dy;
    let t = den === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / den;
    t = Math.min(Math.min(1, (hi - cum[i]) / len), Math.max(Math.max(0, (lo - cum[i]) / len), t));
    const off = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    const along = cum[i] + t * len;
    // 이동 거리만으로는 앞뒤를 가를 수 없는 되돌이 구간에서는 가던 방향(앞쪽)을 택하도록 뒤쪽 후보에 작은 벌점을 준다.
    const score = (off / sigma) ** 2 + ((Math.abs(along - prevAlong) - displacementM) / tau) ** 2 + (along < prevAlong ? BACK_PENALTY : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { along, off };
    }
  }
  return best;
}

/**
 * 경로 위 현재 위치를 찾는다.
 * hintAlongM(직전 위치)이 없으면 전체에서 가장 가까운 지점을 쓴다(첫 위치, 경로 복귀).
 * 있으면 직전 위치와 이동 거리(displacementM)에 맞는 지점을 찾아, 오차 때문에 왕복 경로의 반대편 길로 넘어가지 않게 한다.
 */
export function locate(
  routeCoords: LngLat[],
  cum: Float64Array,
  p: LngLat,
  hintAlongM?: number,
  stopsAlongM?: number[],
  accuracyM = 0,
  displacementM = 0,
): Progress {
  const total = cum.length > 0 ? cum[cum.length - 1] : 0;
  let hit: Hit = { along: 0, off: Infinity };
  if (routeCoords.length === 1) {
    hit = { along: 0, off: distM(p, routeCoords[0]) };
  } else if (routeCoords.length > 1) {
    hit =
      hintAlongM === undefined
        ? scan(routeCoords, cum, p, 0, routeCoords.length - 1)
        : matchStep(routeCoords, cum, p, hintAlongM, displacementM, accuracyM);
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
  const hit = scan(coords, cum, p, lo, n);
  return Math.max(fromAlongM, hit.along);
}
