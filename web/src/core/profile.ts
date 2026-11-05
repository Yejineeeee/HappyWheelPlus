import type { SegmentProps } from "../data/types";
import type { PathResult } from "./dijkstra";
import type { Graph } from "./graph";

/** 경로의 각 노드마다 [누적 거리 m, 노드 고도, 직전 구간 grade_max]. 첫 행은 첫 구간의 경사. */
export function routeProfile(
  g: Graph,
  r: PathResult,
  segProps: (segId: number) => SegmentProps,
): [number, number | null, number | null][] {
  const rows: [number, number | null, number | null][] = [];
  if (r.nodes.length === 0) return rows;
  let cum = 0;
  const first = r.edges.length > 0 ? (segProps(r.edges[0]).grade_max ?? null) : null;
  rows.push([0, g.elev[r.nodes[0]] ?? null, first]);
  for (let i = 0; i < r.edges.length; i++) {
    const p = segProps(r.edges[i]);
    cum += p.len;
    rows.push([cum, g.elev[r.nodes[i + 1]] ?? null, p.grade_max ?? null]);
  }
  return rows;
}
