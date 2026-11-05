import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  computeCustom,
  currentRoute,
  isDefault,
  setCurrentRoute,
  type Conditions,
} from "../src/core/conditions";
import { buildGraph, type Graph } from "../src/core/graph";
import type { CityIndex, Course, PoiKind, SegmentProps, Weights } from "../src/data/types";

const dir = resolve(__dirname, "../public/data");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (p: string): any => JSON.parse(readFileSync(resolve(dir, p), "utf8"));

let graph: Graph;
let segs: SegmentProps[];
let coords: [number, number][][];
let courses: Course[];
let pois: { kind: PoiKind; lon: number; lat: number }[];
let W: Weights;
let alpha: number;

const base = () => ({
  graph,
  segs,
  segCoords: (id: number) => coords[id],
  pois,
  alpha,
});

beforeAll(() => {
  graph = buildGraph(read("lucerne/graph.json"));
  const seg = read("lucerne/segments.geojson");
  segs = seg.features.map((f: { properties: SegmentProps }) => f.properties);
  coords = seg.features.map((f: { geometry: { coordinates: [number, number][] } }) => f.geometry.coordinates);
  courses = read("lucerne/courses.json");
  pois = read("lucerne/pois.geojson").features.map(
    (f: { properties: { kind: PoiKind }; geometry: { coordinates: [number, number] } }) => ({
      kind: f.properties.kind,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }),
  );
  const idx: CityIndex = read("cities.json");
  W = idx.weights_default;
  alpha = idx.alpha;
});

const reachable = () => courses.filter((c) => c.reachable && c.routes.accessible);

describe("computeCustom", () => {
  it("default conditions reuse precomputed route", () => {
    const d: Conditions = { weights: { ...W }, requiredPois: [] };
    expect(isDefault(d, W)).toBe(true);
    expect(isDefault({ weights: { ...W, slope: 1.5 }, requiredPois: [] }, W)).toBe(false);
    expect(isDefault({ weights: { ...W }, requiredPois: ["toilet"] }, W)).toBe(false);
    const c = reachable()[0];
    const r = computeCustom(base(), c, d);
    expect(r.path.reachable).toBe(true);
    expect(r.path.edges).toEqual(c.routes.accessible!.seg_ids);
    expect(r.metrics.length_m).toBeCloseTo(c.routes.accessible!.metrics.length_m, 0);
  });

  it("raising slope weight never increases max_grade on result", () => {
    for (const c of reachable()) {
      const lo = computeCustom(base(), c, { weights: { ...W, slope: 0 }, requiredPois: [] });
      const hi = computeCustom(base(), c, { weights: { ...W, slope: 2 }, requiredPois: [] });
      expect(hi.metrics.max_grade_pct ?? 0).toBeLessThanOrEqual((lo.metrics.max_grade_pct ?? 0) + 1e-9);
    }
  });

  it("required poi missing shows warning", () => {
    const c = reachable()[0];
    const none = computeCustom({ ...base(), pois: [] }, c, { weights: { ...W }, requiredPois: ["toilet"] });
    expect(none.missingPois).toEqual(["toilet"]);
    const nothingRequired = computeCustom({ ...base(), pois: [] }, c, { weights: { ...W }, requiredPois: [] });
    expect(nothingRequired.missingPois).toEqual([]);
  });

  it("segScores length equals segment count", () => {
    const c = reachable()[0];
    const r = computeCustom(base(), c, { weights: { ...W }, requiredPois: [] });
    expect(r.segScores.length).toBe(segs.length);
    segs.forEach((p, i) => {
      if (p.blocked) expect(Number.isNaN(r.segScores[i])).toBe(true);
      else expect(r.segScores[i]).toBeGreaterThanOrEqual(0);
    });
  });

  it("extreme weights still give a route without NaN", () => {
    const c = reachable()[0];
    for (const v of [0, 2]) {
      const r = computeCustom(base(), c, {
        weights: { slope: v, surface: v, kerb: v, uncertainty: v },
        requiredPois: [],
      });
      expect(r.path.reachable).toBe(true);
      expect(Number.isFinite(r.metrics.length_m)).toBe(true);
    }
  });
});

describe("current route store", () => {
  it("stores per city and course", () => {
    expect(currentRoute("x", 0)).toBeNull();
    const r = { coords: [[1, 2]] as [number, number][], segIds: [3], source: "custom" as const };
    setCurrentRoute("x", 0, r);
    expect(currentRoute("x", 0)).toEqual(r);
    expect(currentRoute("x", 1)).toBeNull();
    expect(currentRoute("y", 0)).toBeNull();
  });
});
