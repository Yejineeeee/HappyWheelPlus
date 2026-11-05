import { buildInstructions, nextInstructionText, type Instruction } from "./instructions";
import { cumulative, headingAt, locate, OFF_ROUTE_M, type Progress } from "./progress";
import { startSimulation } from "./simulator";

type LngLat = [number, number];

export type NavSource = "gps" | "sim";

export interface NavUpdate {
  pos: LngLat;
  progress: Progress;
  text: string;
  offRoute: boolean;
  /** 진행 방향(도, 북 = 0). 알 수 없으면 null */
  heading: number | null;
}

export interface NavOptions {
  coords: LngLat[];
  onUpdate: (u: NavUpdate) => void;
  onNeedSimulation: (reason: "denied" | "unavailable") => void;
  source: NavSource;
  geolocation?: Geolocation;
  /** 미리 만든 안내. 없으면 회전과 도착만 만든다. */
  instructions?: Instruction[];
  /** 정류장의 경로상 거리(오름차순 가정) */
  stopsAlongM?: number[];
  /** 가상 위치 시작 지점과 속도 */
  startAlongM?: number;
  speed?: 1 | 4;
}

export interface NavHandle {
  stop(): void;
  setSpeed(s: 1 | 4): void;
  pause(): void;
  resume(): void;
}

export const GPS_FIRST_FIX_TIMEOUT_MS = 15000;

export function startNav(opts: NavOptions): NavHandle {
  const { coords } = opts;
  const cum = cumulative(coords);
  const total = cum.length > 0 ? cum[cum.length - 1] : 0;
  const ins =
    opts.instructions ??
    buildInstructions(coords, [], [{ name: "", atM: 0 }, { name: "", atM: total }]).map((i) =>
      i.kind === "arrive" ? { ...i, text: "목적지 도착" } : i,
    );
  let hint: number | undefined;
  let stopped = false;
  let needSent = false;

  const handle = (pos: LngLat, heading: number | null): void => {
    if (stopped) return;
    const progress = locate(coords, cum, pos, hint, opts.stopsAlongM);
    hint = progress.alongM;
    opts.onUpdate({
      pos,
      progress,
      text: nextInstructionText(ins, progress.alongM),
      offRoute: progress.offRouteM > OFF_ROUTE_M,
      heading: heading ?? headingAt(coords, cum, progress.alongM),
    });
  };

  if (opts.source === "sim") {
    const sim = startSimulation(
      coords,
      opts.speed ?? 1,
      (p, along) => {
        hint = along;
        handle(p, null);
      },
      opts.startAlongM ?? 0,
    );
    return {
      stop() {
        stopped = true;
        sim.stop();
      },
      setSpeed: (s) => sim.setSpeed(s),
      pause: () => sim.pause(),
      resume: () => sim.resume(),
    };
  }

  const geo = opts.geolocation ?? (typeof navigator !== "undefined" ? navigator.geolocation : undefined);
  const noop = { setSpeed() {}, pause() {}, resume() {} };
  const needSim = (reason: "denied" | "unavailable"): void => {
    if (needSent || stopped) return;
    needSent = true;
    opts.onNeedSimulation(reason);
  };
  if (!geo) {
    needSim("unavailable");
    return { stop() { stopped = true; }, ...noop };
  }

  let gotFix = false;
  let firstFixTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    firstFixTimer = null;
    if (!gotFix) needSim("unavailable");
  }, GPS_FIRST_FIX_TIMEOUT_MS);
  const clearTimer = (): void => {
    if (firstFixTimer !== null) clearTimeout(firstFixTimer);
    firstFixTimer = null;
  };

  const watchId = geo.watchPosition(
    (g) => {
      gotFix = true;
      clearTimer();
      const h = g.coords.heading;
      handle([g.coords.longitude, g.coords.latitude], typeof h === "number" && Number.isFinite(h) ? h : null);
    },
    (err) => {
      // 신호가 잠깐 끊기는 정도(이미 위치를 받은 뒤의 오류)는 무시한다.
      if (err.code === 1) needSim("denied");
      else if (!gotFix) needSim("unavailable");
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: GPS_FIRST_FIX_TIMEOUT_MS },
  );

  return {
    stop() {
      stopped = true;
      clearTimer();
      geo.clearWatch(watchId);
    },
    ...noop,
  };
}
