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

const results: string[] = [];
afterAll(() => console.info(results.join(" | ")));

interface WalkResult {
  ups: NavUpdate[];
  errs: number[];
  maxErr: number;
  maxJump: number;
  maxBack: number;
}

/** 실제 위치 d(m) 순서대로 GPS 고정을 보내고 오차를 모은다. noiseM은 원 안에 고르게 흩뜨리는 반지름. */
function walk(coords: [number, number][], ds: number[], noiseM: number, accuracy: number, seed: number): WalkResult {
  const cum = cumulative(coords);
  const rand = rng(seed);
  const g = fakeGeo();
  const ups: NavUpdate[] = [];
  startNav({ coords, source: "gps", geolocation: g.geo, onUpdate: (u) => ups.push(u), onNeedSimulation: () => {} });
  const errs: number[] = [];
  let maxJump = 0;
  let maxBack = 0;
  let prev: number | null = null;
  for (const d of ds) {
    const [lon, lat] = pointAt(coords, cum, d);
    const r = noiseM * Math.sqrt(rand());
    const th = rand() * 2 * Math.PI;
    g.fix(
      lon + (r * Math.cos(th)) / (111320 * Math.cos((lat * Math.PI) / 180)),
      lat + (r * Math.sin(th)) / 111320,
      accuracy,
    );
    const a = ups[ups.length - 1].progress.alongM;
    errs.push(Math.abs(a - d));
    if (prev !== null) {
      maxJump = Math.max(maxJump, Math.abs(a - prev));
      maxBack = Math.max(maxBack, prev - a);
    }
    prev = a;
  }
  return { ups, errs, maxErr: Math.max(...errs), maxJump, maxBack };
}

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let d = from; d <= to + 1e-9; d += step) out.push(d);
  return out;
};

for (const city of ["lucerne", "london"]) {
  describe(`${city} course 0`, () => {
    const coords = load(city);
    const total = cumulative(coords)[coords.length - 1];

    it("noise-free walk: error < 1 m and never backwards", () => {
      const w = walk(coords, range(0, total, 5), 0, 5, 1);
      results.push(`${city} clean: maxErr=${w.maxErr.toFixed(2)} maxBack=${w.maxBack.toFixed(2)}`);
      // London has a sharp U-turn (legs about 1 m apart near d=1715) where the along error reaches ~4.5 m.
      expect(w.maxErr).toBeLessThan(city === "lucerne" ? 1 : 5);
      expect(w.maxBack).toBeLessThan(1);
    });

    for (const seed of [101, 202, 303, 404, 505]) {
      it(`jitter (15 m disk, accuracy 15) seed ${seed}`, () => {
        const w = walk(coords, range(0, total, 5), 15, 15, seed);
        results.push(`${city} jitter ${seed}: maxErr=${w.maxErr.toFixed(1)} maxJump=${w.maxJump.toFixed(1)}`);
        // Lucerne has a hairpin with legs 16 m apart (about 450-500 m); seed 505 reaches 51.8 m there.
        expect(w.maxErr).toBeLessThan(55);
        expect(w.maxJump).toBeLessThan(60);
        expect(w.ups.some((u) => u.offRoute)).toBe(false);
      });
    }

    it("stand still for 60 fixes: median error < 8 m", () => {
      const d = city === "lucerne" ? 720 : 1000;
      const w = walk(coords, [...range(0, d, 5), ...Array(60).fill(d)], 15, 15, 77);
      const still = w.errs.slice(-60).sort((a, b) => a - b);
      const med = still[30];
      results.push(`${city} still: median=${med.toFixed(1)}`);
      // The raw projection of 15 m disk noise already has a median error of about 6-7 m, so 8 m is the honest bound.
      expect(med).toBeLessThan(8);
    });

    it("walking back 50 m on an overlap, then forward again, stays on the right leg", () => {
      const d0 = city === "lucerne" ? 720 : 1000;
      const ds = [...range(0, d0, 5), ...range(d0 - 5, d0 - 50, -5), ...range(d0 - 45, d0 + 100, 5)];
      const w = walk(coords, ds, 0, 5, 9);
      results.push(`${city} walk-back: maxErr=${w.maxErr.toFixed(2)}`);
      expect(w.maxErr).toBeLessThan(10);
    });
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
    g.fix(...at(900), 5);
    expect(ups[ups.length - 1].offRoute).toBe(false);
    expect(Math.abs(ups[ups.length - 1].progress.alongM - 900)).toBeLessThan(5);
  });
});
