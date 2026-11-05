import type { AppContext } from "./types";

type Bounds = [[number, number], [number, number]];

/**
 * 넓은 화면은 지도 칸이 이미 패널 옆이라 균일한 여백만 둔다.
 * 좁은 화면은 시트가 지도 아래쪽을 덮으므로 시트의 현재 높이만큼 아래를 비운다.
 */
export function fitPadding(ctx: AppContext): { top: number; right: number; bottom: number; left: number } {
  const wide = window.matchMedia?.("(min-width: 1024px)").matches ?? false;
  if (wide) return { top: 32, right: 32, bottom: 32, left: 32 };
  // 전환 중에는 측정값이 낡으므로 시트가 향하는 높이를 직접 계산한다.
  const vh = window.innerHeight || 800;
  const snap = ctx.sheet.snap();
  const sheetH = snap === "peek" ? ctx.sheet.peekHeight() : snap === "half" ? vh * 0.5 : vh * 0.88;
  const mapH = ctx.shell.mapContainer.clientHeight || vh;
  return { top: 32, right: 24, bottom: Math.min(sheetH + 24, mapH * 0.75), left: 24 };
}

export function fitTo(ctx: AppContext, bounds: Bounds): void {
  ctx.map.fitTo(bounds, { padding: fitPadding(ctx) });
}
