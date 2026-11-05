import { FLAG, type Weights } from "../data/types";

/** 구간 점수. 통과 불가(blocked)면 null. */
export function scoreEdge(
  p: { p_slope: number; p_surface: number; p_kerb: number; p_unc: number },
  flags: number,
  w: Weights,
): number | null {
  if (flags & FLAG.BLOCKED) return null;
  const total = w.slope * p.p_slope + w.surface * p.p_surface + w.kerb * p.p_kerb + w.uncertainty * p.p_unc;
  let s = Math.min(Math.max(100 - total, 0), 100);
  if (flags & FLAG.WC_YES) s = Math.min(s + 10, 100);
  return s;
}

/** cost = len × (1 + α × (100 − score)/100) */
export function edgeCost(len: number, score: number, alpha: number): number {
  return len * (1 + (alpha * (100 - score)) / 100);
}
