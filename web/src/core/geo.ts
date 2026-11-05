const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;

/** 등장방형 근사 거리(m). 위도 보정은 a의 위도 기준. */
export function distM(a: [number, number], b: [number, number]): number {
  const k = Math.cos(a[1] * RAD);
  const dx = (b[0] - a[0]) * RAD * EARTH_R * k;
  const dy = (b[1] - a[1]) * RAD * EARTH_R;
  return Math.hypot(dx, dy);
}

/** 점에서 폴리라인까지의 최단 거리(m). 점의 위도를 기준으로 투영한다. */
export function pointLineDistM(p: [number, number], line: [number, number][]): number {
  if (line.length === 0) return Infinity;
  const k = Math.cos(p[1] * RAD);
  const px = p[0] * RAD * EARTH_R * k;
  const py = p[1] * RAD * EARTH_R;
  const xs = line.map((c) => c[0] * RAD * EARTH_R * k);
  const ys = line.map((c) => c[1] * RAD * EARTH_R);
  if (line.length === 1) return Math.hypot(xs[0] - px, ys[0] - py);
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const abx = xs[i + 1] - xs[i];
    const aby = ys[i + 1] - ys[i];
    const denom = abx * abx + aby * aby;
    let t = denom === 0 ? 0 : ((px - xs[i]) * abx + (py - ys[i]) * aby) / denom;
    t = Math.min(1, Math.max(0, t));
    best = Math.min(best, Math.hypot(xs[i] + t * abx - px, ys[i] + t * aby - py));
  }
  return best;
}
