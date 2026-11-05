import { FLAG, type GraphJson } from "../data/types";

export interface Graph {
  n: number;
  nodes: [number, number][];
  elev: (number | null)[];
  adj: Int32Array;
  adjStart: Int32Array;
  eu: Int32Array;
  ev: Int32Array;
  len: Float64Array;
  /** 간선당 4개: slope, surface, kerb, unc */
  pen: Float32Array;
  flags: Uint8Array;
  mainComponent: Uint8Array;
}

export function buildGraph(g: GraphJson): Graph {
  const n = g.nodes.length;
  const E = g.edges.length;
  const eu = new Int32Array(E);
  const ev = new Int32Array(E);
  const len = new Float64Array(E);
  const pen = new Float32Array(4 * E);
  const flags = new Uint8Array(E);
  const deg = new Int32Array(n + 1);
  for (let i = 0; i < E; i++) {
    const r = g.edges[i];
    eu[i] = r[0];
    ev[i] = r[1];
    len[i] = r[2];
    pen[4 * i] = r[3];
    pen[4 * i + 1] = r[4];
    pen[4 * i + 2] = r[5];
    pen[4 * i + 3] = r[6];
    flags[i] = r[7];
    if (r[0] !== r[1]) {
      deg[r[0]]++;
      deg[r[1]]++;
    }
  }
  const adjStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) adjStart[i + 1] = adjStart[i] + deg[i];
  const adj = new Int32Array(adjStart[n]);
  const fill = adjStart.slice(0, n);
  for (let i = 0; i < E; i++) {
    if (eu[i] === ev[i]) continue;
    adj[fill[eu[i]]++] = i;
    adj[fill[ev[i]]++] = i;
  }

  // 비-blocked 간선만으로 가장 큰 연결 덩어리 (union-find)
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  let anyPassable = false;
  for (let i = 0; i < E; i++) {
    if (flags[i] & FLAG.BLOCKED || eu[i] === ev[i]) continue;
    anyPassable = true;
    const a = find(eu[i]);
    const b = find(ev[i]);
    if (a !== b) parent[a] = b;
  }
  const mainComponent = new Uint8Array(n);
  if (!anyPassable) {
    mainComponent.fill(1);
  } else {
    const size = new Int32Array(n);
    for (let i = 0; i < n; i++) size[find(i)]++;
    let best = 0;
    for (let i = 1; i < n; i++) if (size[i] > size[best]) best = i;
    for (let i = 0; i < n; i++) if (find(i) === best) mainComponent[i] = 1;
  }

  return { n, nodes: g.nodes, elev: g.elev, adj, adjStart, eu, ev, len, pen, flags, mainComponent };
}

const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;

export function snapStops(g: Graph, stops: [number, number][]): { nodes: number[]; snapM: number[] } {
  const nodes: number[] = [];
  const snapM: number[] = [];
  const ids: number[] = [];
  for (let i = 0; i < g.n; i++) if (g.mainComponent[i]) ids.push(i);
  if (ids.length === 0) return { nodes, snapM };
  for (const [lon, lat] of stops) {
    const kx = Math.cos(lat * RAD) * RAD * EARTH_R;
    const ky = RAD * EARTH_R;
    let best = Infinity;
    let bi = ids[0];
    for (let j = 0; j < ids.length; j++) {
      const c = g.nodes[ids[j]];
      const dx = (c[0] - lon) * kx;
      const dy = (c[1] - lat) * ky;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bi = ids[j];
      }
    }
    nodes.push(bi);
    snapM.push(Math.sqrt(best));
  }
  return { nodes, snapM };
}
