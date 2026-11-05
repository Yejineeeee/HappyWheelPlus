import { describe, expect, it } from "vitest";
import { buildGraph, snapStops } from "../src/core/graph";
import { pathCoords, routeStops } from "../src/core/dijkstra";
import { edgeCost, scoreEdge } from "../src/core/scoring";
import { distM, pointLineDistM } from "../src/core/geo";
import type { EdgeRow, GraphJson, Weights } from "../src/data/types";

const W: Weights = { slope: 1, surface: 0.8, kerb: 0.6, uncertainty: 0.3 };
const P0 = { p_slope: 0, p_surface: 0, p_kerb: 0, p_unc: 0 };

describe("scoreEdge", () => {
  it("scoreEdge clamps and applies wc bonus after clamp", () => {
    const big = { p_slope: 100, p_surface: 100, p_kerb: 100, p_unc: 100 };
    expect(scoreEdge(big, 0, W)).toBe(0);
    expect(scoreEdge(big, 4, W)).toBe(10);
    expect(scoreEdge(P0, 4, W)).toBe(100);
    expect(scoreEdge(P0, 1, W)).toBeNull();
    expect(scoreEdge({ ...P0, p_slope: 40 }, 0, W)).toBeCloseTo(60);
  });
  it("edgeCost follows formula", () => {
    expect(edgeCost(100, 100, 3)).toBe(100);
    expect(edgeCost(100, 0, 3)).toBe(400);
  });
});

// 0-1 short but steps (blocked); 0-2-3-1 long way; node 4 attached to 0 only via steps
function hand(): GraphJson {
  const nodes: [number, number][] = [
    [8.0, 47.0],
    [8.001, 47.0],
    [8.0, 47.001],
    [8.001, 47.001],
    [8.00001, 47.00001],
  ];
  const row = (u: number, v: number, len: number, flags: number): EdgeRow => [u, v, len, 0, 0, 0, 0, flags];
  return {
    nodes,
    elev: [1, 2, 3, 4, 5],
    edges: [row(0, 1, 75, 3), row(0, 2, 111, 0), row(2, 3, 75, 0), row(3, 1, 111, 0), row(4, 0, 2, 3), row(2, 2, 5, 0)],
  };
}

describe("hand graph", () => {
  const g = buildGraph(hand());
  it("snapStops avoids steps-only island", () => {
    expect(g.mainComponent[4]).toBe(0);
    const { nodes, snapM } = snapStops(g, [[8.00001, 47.00001]]);
    expect(nodes[0]).toBe(0);
    expect(snapM[0]).toBeCloseTo(distM([8.00001, 47.00001], [8.0, 47.0]), 1);
  });
  it("accessible route avoids blocked steps; shortest may use them", () => {
    const s = routeStops(g, [0, 1], W, 3, "shortest");
    expect(s.edges).toEqual([0]);
    const a = routeStops(g, [0, 1], W, 3, "accessible");
    expect(a.edges).toEqual([1, 2, 3]);
    expect(a.nodes).toEqual([0, 2, 3, 1]);
  });
  it("reports unreachable leg", () => {
    const r = routeStops(g, [0, 1, 4], W, 3, "accessible");
    expect(r.reachable).toBe(false);
    expect(r.blockedLeg).toBe(1);
    expect(r.edges).toEqual([1, 2, 3]);
  });
  it("same-node stops give empty leg; self loops ignored", () => {
    const r = routeStops(g, [0, 0], W, 3, "accessible");
    expect(r.reachable).toBe(true);
    expect(r.edges).toEqual([]);
    expect(g.adj.length).toBe(10);
  });
  it("pathCoords reverses v->u traversals and drops joints", () => {
    const a = routeStops(g, [1, 0], W, 3, "accessible");
    const segs: Record<number, [number, number][]> = {
      1: [g.nodes[0], [8.0, 47.0005], g.nodes[2]],
      2: [g.nodes[2], g.nodes[3]],
      3: [g.nodes[3], g.nodes[1]],
    };
    const c = pathCoords(g, (id) => segs[id], a);
    expect(c).toEqual([g.nodes[1], g.nodes[3], g.nodes[2], [8.0, 47.0005], g.nodes[0]]);
  });
});

describe("geo", () => {
  it("pointLineDistM", () => {
    const d = pointLineDistM([8.0005, 47.0001], [[8.0, 47.0], [8.001, 47.0]]);
    expect(d).toBeCloseTo(11.1, 0);
  });
});
