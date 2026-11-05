import type { CityIndex } from "../data/types";
import type { AppMap } from "../map/map";
import type { Route } from "../router";
import type { Shell } from "../ui/shell";
import type { Sheet } from "../ui/sheet";

export interface AppContext {
  map: AppMap;
  sheet: Sheet;
  shell: Shell;
  index: CityIndex;
  navigate(r: Exclude<Route, { name: "notFound" }>): void;
  /** 화면이 바뀌면 중단된다. 진행 중인 작업은 이 신호를 확인한다. */
  signal: AbortSignal;
}

export interface View {
  mount(ctx: AppContext): void | Promise<void>;
  unmount(): void;
}
