export type PlotModule = typeof import("@observablehq/plot");

let mod: PlotModule | null = null;
let pending: Promise<PlotModule> | null = null;

/** 그래프 라이브러리는 처음 그릴 때만 내려받는다(첫 화면 번들에서 뺀다). */
export function loadPlot(): Promise<PlotModule> {
  if (mod) return Promise.resolve(mod);
  pending ??= import("@observablehq/plot").then(
    (m) => {
      mod = m;
      return m;
    },
    (e: unknown) => {
      pending = null;
      throw e;
    },
  );
  return pending;
}

/** 이미 불러왔으면 모듈, 아니면 null. */
export function plotIfLoaded(): PlotModule | null {
  return mod;
}
