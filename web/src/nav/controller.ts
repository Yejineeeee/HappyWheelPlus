import { distM } from "../core/geo";
import { buildInstructions, nextInstructionText, type Instruction } from "./instructions";
import { cumulative, headingAt, locate, OFF_ROUTE_M, type Progress } from "./progress";
import { startSimulation } from "./simulator";

type LngLat = [number, number];

export type NavSource = "gps" | "sim";

/** denied: 권한 거부, unavailable: 위치를 못 얻음, far: 첫 위치가 경로에서 너무 멀다(다른 도시). */
export type NeedSimReason = "denied" | "unavailable" | "far";

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
  onNeedSimulation: (reason: NeedSimReason) => void;
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
/** 첫 위치가 경로에서 이만큼 넘게 떨어져 있으면 이 도시에 있지 않은 것으로 본다. */
export const FAR_FROM_ROUTE_M = 3000;

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
  let prevFix: LngLat | null = null;
  let stopped = false;
  let needSent = false;
  let firstChecked = false;

  // 경로에서 벗어난 상태가 이어진 횟수. 위치 정확도만큼은 오차로 보고 뺀다.
  let offCount = 0;
  const handle = (pos: LngLat, heading: number | null, accuracy = 0): void => {
    if (stopped) return;
    const disp = prevFix ? distM(prevFix, pos) : 0;
    prevFix = pos;
    // 직전 고정이 경로 밖이었다면 이동 거리 기준이 맞지 않으므로(순간 이동 포함) 전체에서 다시 찾는다.
    const useHint = hint !== undefined && offCount === 0;
    let progress = locate(coords, cum, pos, useHint ? hint : undefined, opts.stopsAlongM, accuracy, disp);
    let off = progress.offRouteM - accuracy > OFF_ROUTE_M;
    if (opts.source === "gps" && !firstChecked) {
      firstChecked = true;
      if (progress.offRouteM > FAR_FROM_ROUTE_M) {
        needSim("far");
        stopped = true;
        clearTimer();
        geo?.clearWatch(watchId);
        return;
      }
    }
    if (off) {
      offCount++;
      if (offCount >= 2 && useHint) {
        progress = locate(coords, cum, pos, undefined, opts.stopsAlongM);
        off = progress.offRouteM - accuracy > OFF_ROUTE_M;
      }
    } else offCount = 0;
    if (!off) offCount = 0;
    hint = progress.alongM;
    opts.onUpdate({
      pos,
      progress,
      text: nextInstructionText(ins, progress.alongM),
      offRoute: off && offCount >= 2,
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
  const needSim = (reason: NeedSimReason): void => {
    if (needSent || stopped) return;
    needSent = true;
    opts.onNeedSimulation(reason);
  };
  if (!geo) {
    needSim("unavailable");
    return { stop() { stopped = true; }, ...noop };
  }

  let gotFix = false;
  let watchId = -1;
  let firstFixTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    firstFixTimer = null;
    if (!gotFix) {
      needSim("unavailable");
      geo.clearWatch(watchId);
    }
  }, GPS_FIRST_FIX_TIMEOUT_MS);
  const clearTimer = (): void => {
    if (firstFixTimer !== null) clearTimeout(firstFixTimer);
    firstFixTimer = null;
  };

  watchId = geo.watchPosition(
    (g) => {
      gotFix = true;
      clearTimer();
      const h = g.coords.heading;
      const acc = g.coords.accuracy;
      handle(
        [g.coords.longitude, g.coords.latitude],
        typeof h === "number" && Number.isFinite(h) ? h : null,
        typeof acc === "number" && Number.isFinite(acc) ? acc : 0,
      );
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
