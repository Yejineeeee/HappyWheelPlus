import { cumulative, pointAt } from "./progress";

type LngLat = [number, number];

export const TICK_MS = 250;
const BASE_SPEED_MPS = 1.0;

export interface Simulation {
  stop(): void;
  setSpeed(s: 1 | 4): void;
  pause(): void;
  resume(): void;
  alongM(): number;
}

/** 경로를 따라 가상 위치를 보낸다. 1× = 1.0 m/s, 250ms 틱. 끝에 닿으면 마지막 위치를 보내고 멈춘다. */
export function startSimulation(
  coords: LngLat[],
  speed: 1 | 4,
  onPos: (p: LngLat, alongM: number) => void,
  startAlongM = 0,
): Simulation {
  const cum = cumulative(coords);
  const total = cum.length > 0 ? cum[cum.length - 1] : 0;
  let along = Math.min(total, Math.max(0, startAlongM));
  let mult: 1 | 4 = speed;
  let timer: ReturnType<typeof setInterval> | null = null;
  let dead = false;

  const emit = (): void => {
    if (coords.length > 0) onPos(pointAt(coords, cum, along), along);
  };
  const clear = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const run = (): void => {
    if (dead || timer !== null) return;
    timer = setInterval(() => {
      along = Math.min(total, along + mult * BASE_SPEED_MPS * (TICK_MS / 1000));
      emit();
      if (along >= total) clear();
    }, TICK_MS);
  };

  emit();
  if (along < total) run();

  return {
    stop() {
      dead = true;
      clear();
    },
    setSpeed(s) {
      mult = s;
    },
    pause: clear,
    resume() {
      if (along < total) run();
    },
    alongM: () => along,
  };
}
