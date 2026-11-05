import { FLAG, type RouteMetrics, type SegmentProps, type Weights } from "../data/types";
import type { PathResult } from "./dijkstra";
import { pointLineDistM } from "./geo";
import { scoreEdge } from "./scoring";

const STEEP_GRADE = 6;
const TOILET_RADIUS_M = 300;

export function routeMetrics(
  r: PathResult,
  segProps: (segId: number) => SegmentProps,
  coords: [number, number][],
  toilets: [number, number][],
  w: Weights,
): RouteMetrics {
  let length = 0;
  let steps = 0;
  let steep = 0;
  let cobble = 0;
  let sw = 0;
  let sum = 0;
  let maxGrade: number | null = null;
  for (const id of r.edges) {
    const p = segProps(id);
    length += p.len;
    if (p.steps && p.blocked) steps++;
    if (p.grade_max !== null && p.grade_max !== undefined) {
      if (maxGrade === null || p.grade_max > maxGrade) maxGrade = p.grade_max;
      if (p.grade_max >= STEEP_GRADE) steep += p.len;
    }
    if (p.surface_class === "cobble") cobble += p.len;
    if (!p.blocked) {
      const s = scoreEdge(p, p.wc_yes ? FLAG.WC_YES : 0, w) as number;
      sw += p.len;
      sum += s * p.len;
    }
  }
  const toiletsN =
    r.edges.length > 0 ? toilets.filter((t) => pointLineDistM(t, coords) <= TOILET_RADIUS_M).length : 0;
  return {
    length_m: length,
    steps_count: steps,
    max_grade_pct: maxGrade,
    steep_m: steep,
    cobble_m: cobble,
    mean_score: sw > 0 ? sum / sw : null,
    toilets_300m: toiletsN,
  };
}
