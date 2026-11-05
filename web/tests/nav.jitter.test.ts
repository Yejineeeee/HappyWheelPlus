import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course } from "../src/data/types";
import { startNav, type NavUpdate } from "../src/nav/controller";
import { cumulative, pointAt } from "../src/nav/progress";

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const load = (city: string): [number, number][] =>
  (JSON.parse(readFileSync(resolve(__dirname, `../public/data/${city}/courses.json`), "utf8")) as Course[])[0].routes.accessible!.coords;

function fakeGeo() {
  let ok: PositionCallback = () => {};
  return {
    geo: { watchPosition: (s: PositionCallback) => ((ok = s), 1), clearWatch: () => {} } as unknown as Geolocation,
    fix: (lon: number, lat: number, accuracy: number) =>
      ok({ coords: { longitude: lon, latitude: lat, heading: null, accuracy } } as GeolocationPosition),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const NOISE_M = 15;
const results: string[] = [];
afterAll(() => console.info(results.join(" | ")));

for (const city of ["lucerne", "london"]) {
  describe(`${city} course 0 with GPS jitter`, () => {
    const coords = load(city);
    const cum = cumulative(coords);
    const total = cum[cum.length - 1];
    for (const seed of [1, 2, 3]) {
      it(`seed ${seed}: bounded error, no jumps, no warnings`, () => {
        const rand = rng(seed * 7919);
        const g = fakeGeo();
        const ups: NavUpdate[] = [];
        startNav({ coords, source: "gps", geolocation: g.geo, onUpdate: (u) => ups.push(u), onNeedSimulation: () => {} });
        let maxErr = 0;
        let maxJump = 0;
        let prev: number | null = null;
        for (let d = 0; d <= total; d += 5) {
          const [lon, lat] = pointAt(coords, cum, d);
          // 반지름 15 m 원 안에서 고르게 흩뜨린다(정확도 15 m = 오차 반경).
          const r = NOISE_M * Math.sqrt(rand());
          const th = rand() * 2 * Math.PI;
          const dx = r * Math.cos(th);
          const dy = r * Math.sin(th);
          g.fix(lon + dx / (111320 * Math.cos((lat * Math.PI) / 180)), lat + dy / 111320, NOISE_M);
          const u = ups[ups.length - 1];
          maxErr = Math.max(maxErr, Math.abs(u.progress.alongM - d));
          if (prev !== null) maxJump = Math.max(maxJump, u.progress.alongM - prev);
          prev = u.progress.alongM;
        }
        results.push(`${city} seed ${seed}: maxErr=${maxErr.toFixed(1)} maxJump=${maxJump.toFixed(1)}`);
        expect(maxErr).toBeLessThan(40);
        expect(maxJump).toBeLessThanOrEqual(60);
        expect(ups.some((u) => u.offRoute)).toBe(false);
      });
    }
  });
}

describe("recovery", () => {
  it("200 m off twice triggers a full scan and re-acquires the route", () => {
    const coords = load("lucerne");
    const cum = cumulative(coords);
    const g = fakeGeo();
    const ups: NavUpdate[] = [];
    startNav({ coords, source: "gps", geolocation: g.geo, onUpdate: (u) => ups.push(u), onNeedSimulation: () => {} });
    const at = (d: number, offM = 0): [number, number] => {
      const [lon, lat] = pointAt(coords, cum, d);
      return [lon + offM / (111320 * Math.cos((lat * Math.PI) / 180)), lat];
    };
    for (let d = 0; d <= 100; d += 5) g.fix(...at(d), 5);
    g.fix(...at(100, 200), 5);
    g.fix(...at(100, 200), 5);
    expect(ups[ups.length - 1].offRoute).toBe(true);
    // 경로 반대편 끝(처음 위치에서 800 m 이상 앞)으로 돌아오면 전체 탐색으로 다시 잡는다.
    g.fix(...at(900), 5);
    expect(ups[ups.length - 1].offRoute).toBe(false);
    expect(Math.abs(ups[ups.length - 1].progress.alongM - 900)).toBeLessThan(5);
  });
});
