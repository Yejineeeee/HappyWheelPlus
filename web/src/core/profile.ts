import type { SegmentProps } from "../data/types";
import type { PathResult } from "./dijkstra";
import type { Graph } from "./graph";

/** 내보낸 프로필과 같은 간격(m). */
export const PROFILE_STEP_M = 25;

/**
 * 경로를 25 m 간격으로 나눈 각 지점의 [누적 거리 m, 고도 m|null, 경사 %|null].
 * 고도는 경로 노드 고도를 누적 길이에 따라 선형 보간한 값(양 끝 노드 중 하나라도 없으면 null),
 * 경사는 지점이 놓인 구간의 grade_max다. 끝점은 25 m 배수가 아니어도 마지막에 한 번 더 넣는다.
 */
export function routeProfile(
  g: Graph,
  r: PathResult,
  segProps: (segId: number) => SegmentProps,
): [number, number | null, number | null][] {
  const rows: [number, number | null, number | null][] = [];
  if (r.nodes.length === 0) return rows;
  const n = r.edges.length;
  const starts = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) starts[i + 1] = starts[i] + segProps(r.edges[i]).len;
  const total = starts[n];
  const elev = (i: number): number | null => g.elev[r.nodes[i]] ?? null;
  if (n === 0) return rows;

  const at = (d: number, edge: number): [number, number | null, number | null] => {
    const a = elev(edge);
    const b = elev(edge + 1);
    const len = starts[edge + 1] - starts[edge];
    const t = len <= 0 ? 0 : Math.min(Math.max((d - starts[edge]) / len, 0), 1);
    const e = a === null || b === null || Number.isNaN(a) || Number.isNaN(b) ? null : a + (b - a) * t;
    return [d, e, segProps(r.edges[edge]).grade_max ?? null];
  };

  let edge = 0;
  for (let d = 0; d <= total + 1e-9; d += PROFILE_STEP_M) {
    while (edge < n - 1 && starts[edge + 1] <= d + 1e-6) edge++;
    rows.push(at(Math.min(d, total), edge));
  }
  if (total - rows[rows.length - 1][0] > 1e-3) rows.push(at(total, n - 1));
  return rows;
}
