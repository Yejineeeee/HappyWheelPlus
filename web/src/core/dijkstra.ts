import { FLAG, type Weights } from "../data/types";
import type { Graph } from "./graph";
import { edgeCost, scoreEdge } from "./scoring";

export interface PathResult {
  reachable: boolean;
  /** 이동 순서대로의 간선 id (= seg_id) */
  edges: number[];
  /** 방문 노드 (edges.length + 1개, 경로가 비면 0~1개) */
  nodes: number[];
  blockedLeg: number | null;
}

class Heap {
  keys: number[] = [];
  vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, v: number): void {
    const K = this.keys;
    const V = this.vals;
    let i = K.length;
    K.push(k);
    V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p];
      V[i] = V[p];
      i = p;
    }
    K[i] = k;
    V[i] = v;
  }
  pop(): [number, number] {
    const K = this.keys;
    const V = this.vals;
    const rk = K[0];
    const rv = V[0];
    const lk = K.pop() as number;
    const lv = V.pop() as number;
    const n = K.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= lk) break;
        K[i] = K[c];
        V[i] = V[c];
        i = c;
      }
      K[i] = lk;
      V[i] = lv;
    }
    return [rk, rv];
  }
}

export function routeStops(
  g: Graph,
  stopNodes: number[],
  w: Weights,
  alpha: number,
  mode: "shortest" | "accessible",
): PathResult {
  const res: PathResult = { reachable: true, edges: [], nodes: [], blockedLeg: null };
  if (stopNodes.length === 0) return res;

  // 간선 비용 (Infinity = 사용 불가)
  const E = g.len.length;
  const cost = new Float64Array(E);
  for (let e = 0; e < E; e++) {
    if (mode === "shortest") {
      cost[e] = g.len[e];
    } else if (g.flags[e] & FLAG.BLOCKED) {
      cost[e] = Infinity;
    } else {
      const s = scoreEdge(
        { p_slope: g.pen[4 * e], p_surface: g.pen[4 * e + 1], p_kerb: g.pen[4 * e + 2], p_unc: g.pen[4 * e + 3] },
        g.flags[e],
        w,
      ) as number;
      cost[e] = edgeCost(g.len[e], s, alpha);
    }
  }

  res.nodes.push(stopNodes[0]);
  const dist = new Float64Array(g.n);
  const prevEdge = new Int32Array(g.n);
  for (let leg = 0; leg + 1 < stopNodes.length; leg++) {
    const s = stopNodes[leg];
    const t = stopNodes[leg + 1];
    if (s === t) continue;
    dist.fill(Infinity);
    prevEdge.fill(-1);
    dist[s] = 0;
    const heap = new Heap();
    heap.push(0, s);
    while (heap.size > 0) {
      const [d, u] = heap.pop();
      if (d > dist[u]) continue;
      if (u === t) break;
      for (let a = g.adjStart[u]; a < g.adjStart[u + 1]; a++) {
        const e = g.adj[a];
        const c = cost[e];
        if (c === Infinity) continue;
        const v = g.eu[e] === u ? g.ev[e] : g.eu[e];
        const nd = d + c;
        if (nd < dist[v]) {
          dist[v] = nd;
          prevEdge[v] = e;
          heap.push(nd, v);
        }
      }
    }
    if (dist[t] === Infinity) {
      res.reachable = false;
      res.blockedLeg = leg;
      return res;
    }
    const legEdges: number[] = [];
    const legNodes: number[] = [];
    for (let v = t; v !== s; ) {
      const e = prevEdge[v];
      legEdges.push(e);
      legNodes.push(v);
      v = g.eu[e] === v ? g.ev[e] : g.eu[e];
    }
    legEdges.reverse();
    legNodes.reverse();
    for (let i = 0; i < legEdges.length; i++) {
      res.edges.push(legEdges[i]);
      res.nodes.push(legNodes[i]);
    }
  }
  return res;
}

export function pathCoords(
  g: Graph,
  segCoords: (segId: number) => [number, number][],
  r: PathResult,
): [number, number][] {
  const out: [number, number][] = [];
  if (r.nodes.length === 0) return out;
  out.push(g.nodes[r.nodes[0]]);
  for (let i = 0; i < r.edges.length; i++) {
    const e = r.edges[i];
    let c = segCoords(e);
    // 구간 좌표는 u→v 방향이므로 v→u로 지나면 뒤집는다
    if (r.nodes[i] === g.ev[e]) c = c.slice().reverse();
    for (let j = 1; j < c.length; j++) out.push(c[j]);
  }
  return out;
}
