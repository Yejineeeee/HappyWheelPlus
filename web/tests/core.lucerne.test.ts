import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildGraph, snapStops, type Graph } from "../src/core/graph";
import { pathCoords, routeStops, type PathResult } from "../src/core/dijkstra";
import { routeMetrics } from "../src/core/metrics";
import { routeProfile } from "../src/core/profile";
import { scoreEdge } from "../src/core/scoring";
import type { CityIndex, Course, GraphJson, SegmentProps, Weights } from "../src/data/types";

const dir = resolve(__dirname, "../public/data");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (p: string): any => JSON.parse(readFileSync(resolve(dir, p), "utf8"));

let g: Graph;
let gj: GraphJson;
let props: SegmentProps[];
let coords: [number, number][][];
let courses: Course[];
let toilets: [number, number][];
let W: Weights;
let alpha: number;
const sp = (i: number) => props[i];
const sc = (i: number) => coords[i];

beforeAll(() => {
  gj = read("lucerne/graph.json");
  g = buildGraph(gj);
  const seg = read("lucerne/segments.geojson");
  props = seg.features.map((f: { properties: SegmentProps }) => f.properties);
  coords = seg.features.map((f: { geometry: { coordinates: [number, number][] } }) => f.geometry.coordinates);
  courses = read("lucerne/courses.json");
  const pois = read("lucerne/pois.geojson");
  toilets = pois.features
    .filter((f: { properties: { kind: string } }) => f.properties.kind === "toilet")
    .map((f: { geometry: { coordinates: [number, number] } }) => f.geometry.coordinates);
  const idx: CityIndex = read("cities.json");
  W = idx.weights_default;
  alpha = idx.alpha;
});

function stopNodes(c: Course): number[] {
  return snapStops(g, c.stops.map((s) => [s.lon, s.lat] as [number, number])).nodes;
}

describe("lucerne parity", () => {
  it("scoreEdge matches exported score for every lucerne segment", () => {
    expect(props.length).toBe(gj.edges.length);
    let worst = 0;
    for (let i = 0; i < props.length; i++) {
      const r = gj.edges[i];
      const s = scoreEdge({ p_slope: r[3], p_surface: r[4], p_kerb: r[5], p_unc: r[6] }, r[7], W);
      if (props[i].score === null) expect(s).toBeNull();
      else worst = Math.max(worst, Math.abs((s as number) - (props[i].score as number)));
    }
    console.log("max score diff", worst);
    expect(worst).toBeLessThanOrEqual(0.15);
  });

  it("routes with all-zero and all-max weights", () => {
    for (const w of [
      { slope: 0, surface: 0, kerb: 0, uncertainty: 0 },
      { slope: 2, surface: 2, kerb: 2, uncertainty: 2 },
    ]) {
      const r = routeStops(g, stopNodes(courses[0]), w, alpha, "accessible");
      expect(r.reachable).toBe(true);
      const len = r.edges.reduce((a, e) => a + g.len[e], 0);
      expect(Number.isFinite(len)).toBe(true);
      expect(len).toBeGreaterThan(0);
    }
  });

  it("default-weight accessible route matches pipeline length within 2%", () => {
    for (const c of courses) {
      if (!c.routes.accessible) continue;
      const r = routeStops(g, stopNodes(c), W, alpha, "accessible");
      expect(r.reachable).toBe(true);
      const len = r.edges.reduce((a, e) => a + g.len[e], 0);
      const ref = c.routes.accessible.metrics.length_m;
      console.log(`course ${c.index} accessible ${len.toFixed(1)} vs ${ref} (${(((len - ref) / ref) * 100).toFixed(3)}%)`);
      expect(Math.abs(len - ref) / ref).toBeLessThan(0.02);
    }
  });

  it("routeMetrics equals pipeline metrics for lucerne accessible route", () => {
    for (const c of courses) {
      const rd = c.routes.accessible;
      if (!rd) continue;
      const ids = rd.seg_ids;
      const nodes: number[] = [];
      if (ids.length > 0) {
        const first = ids[0];
        const start = rd.coords[0];
        const du = Math.hypot(g.nodes[g.eu[first]][0] - start[0], g.nodes[g.eu[first]][1] - start[1]);
        const dv = Math.hypot(g.nodes[g.ev[first]][0] - start[0], g.nodes[g.ev[first]][1] - start[1]);
        let cur = du <= dv ? g.eu[first] : g.ev[first];
        nodes.push(cur);
        for (const e of ids) {
          cur = g.eu[e] === cur ? g.ev[e] : g.eu[e];
          nodes.push(cur);
        }
      }
      const r: PathResult = { reachable: true, edges: ids, nodes, blockedLeg: null };
      const pc = pathCoords(g, sc, r);
      const m = routeMetrics(r, sp, pc, toilets, W);
      const ref = rd.metrics;
      console.log(
        `course ${c.index} metrics len ${m.length_m}/${ref.length_m} score ${m.mean_score}/${ref.mean_score} toilets ${m.toilets_300m}/${ref.toilets_300m}`,
      );
      expect(Math.abs(m.length_m - ref.length_m)).toBeLessThanOrEqual(0.5);
      expect(m.steps_count).toBe(ref.steps_count);
      expect(Math.abs(m.cobble_m - ref.cobble_m)).toBeLessThanOrEqual(0.5);
      expect(Math.abs((m.mean_score as number) - (ref.mean_score as number))).toBeLessThanOrEqual(0.2);
      expect(m.toilets_300m).toBe(ref.toilets_300m);
    }
  });

  it("routeProfile is resampled every 25 m like the exported profile", () => {
    const r = routeStops(g, stopNodes(courses[0]), W, alpha, "accessible");
    const prof = routeProfile(g, r, sp);
    const len = r.edges.reduce((a, e) => a + props[e].len, 0);
    expect(prof[0][0]).toBe(0);
    expect(prof[0][1]).toBe(g.elev[r.nodes[0]]);
    expect(prof[prof.length - 1][0]).toBeCloseTo(len, 6);
    for (let i = 1; i < prof.length - 1; i++) expect(prof[i][0] - prof[i - 1][0]).toBeCloseTo(25, 6);
    const lastGap = prof[prof.length - 1][0] - prof[prof.length - 2][0];
    expect(lastGap).toBeGreaterThan(0);
    expect(lastGap).toBeLessThanOrEqual(25 + 1e-6);
    // 내보낸 프로필과 지점 수·거리가 거의 같고, 고도는 몇 미터 안에서 같다.
    const ref = courses[0].routes.accessible!.profile;
    // 끝점은 길이 반올림 차이로 한 행 더 있을 수 있다.
    expect(Math.abs(prof.length - ref.length)).toBeLessThanOrEqual(1);
    for (let i = 0; i < Math.min(prof.length, ref.length) - 1; i++) {
      expect(prof[i][0]).toBeCloseTo(ref[i][0], 0);
      if (prof[i][1] !== null && ref[i][1] !== null) expect(Math.abs(prof[i][1]! - ref[i][1]!)).toBeLessThan(6);
    }
  });

  it("pathCoords is continuous", () => {
    const r = routeStops(g, stopNodes(courses[0]), W, alpha, "accessible");
    const pc = pathCoords(g, sc, r);
    const R = 6371008.8 * (Math.PI / 180);
    const d = (a: number[], b: number[]) =>
      Math.hypot((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180) * R, (b[1] - a[1]) * R);
    let k = 0;
    for (let i = 0; i < r.edges.length; i++) {
      k += coords[r.edges[i]].length - 1;
      expect(d(pc[k], g.nodes[r.nodes[i + 1]])).toBeLessThan(1);
    }
    expect(pc.length).toBe(k + 1);
    let off = 0;
    for (let i = 0; i < r.edges.length; i++) {
      const n = coords[r.edges[i]].length - 1;
      let seg = 0;
      for (let j = 0; j < n; j++) seg = Math.max(seg, d(pc[off + j], pc[off + j + 1]));
      expect(seg).toBeLessThanOrEqual(g.len[r.edges[i]] + 1);
      off += n;
    }
  });
});
