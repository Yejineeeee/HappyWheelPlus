import type { AppContext } from "./types";

type Bounds = [[number, number], [number, number]];

/** 시트가 가리는 쪽을 비워 두고 맞춘다. 넓은 화면은 왼쪽 패널 400px, 좁은 화면은 접힌 시트 높이. */
export function fitPadding(): { top: number; right: number; bottom: number; left: number } {
  const wide = window.matchMedia?.("(min-width: 1024px)").matches ?? false;
  return wide
    ? { top: 48, right: 48, bottom: 48, left: 400 + 48 }
    : { top: 48, right: 32, bottom: 132 + 24, left: 32 };
}

export function fitTo(ctx: AppContext, bounds: Bounds): void {
  ctx.map.fitTo(bounds, { padding: fitPadding() });
}
