export function fmtM(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export function fmtPct(p: number | null): string {
  return p === null ? "–" : `${p.toFixed(1)}%`;
}

export function fmtDelta(m: number): string {
  const r = Math.round(m);
  if (r > 0) return `+${r}m`;
  if (r < 0) return `−${-r}m`;
  return "0m";
}

export function scoreLabel(s: number | null): string {
  if (s === null) return "지나갈 수 없는 길";
  if (s >= 80) return "좋음";
  if (s >= 55) return "보통";
  return "어려움";
}
