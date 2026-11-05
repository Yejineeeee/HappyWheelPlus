import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ABORT_GRACE_MS, clearDataCache, DataError, loadCourses, loadGraph, loadIndex, loadPois, loadSegments } from "../src/data/load";
import { cachedGraph, cachedSegProps } from "../src/core/conditions";
import type { CityIndex, Course } from "../src/data/types";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (p: string): string => readFileSync(join(FIX, p), "utf8");
const index = JSON.parse(read("cities.json")) as CityIndex;
const city = index.cities[0]!;

function serve(overrides: Record<string, () => Response> = {}) {
  const mock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const m = /data\/(?:(fakecity)\/)?([^/?]+)\?v=/.exec(url);
    const file = m ? (m[1] ? `${m[1]}/${m[2]}` : m[2]!) : "";
    const o = overrides[file];
    if (o) return o();
    return new Response(read(file), { status: 200 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => clearDataCache());
afterEach(() => vi.unstubAllGlobals());

describe("data loaders", () => {
  it("dedupes concurrent loads", async () => {
    const mock = serve();
    const [a, b] = await Promise.all([loadCourses(city), loadCourses(city)]);
    expect(a).toBe(b);
    await loadCourses(city);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("retries after failure", async () => {
    let n = 0;
    const mock = serve({
      "fakecity/courses.json": () =>
        n++ === 0 ? new Response("boom", { status: 500 }) : new Response(read("fakecity/courses.json")),
    });
    const err = await loadCourses(city).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as DataError).status).toBe(500);
    expect((err as DataError).file).toBe("fakecity/courses.json");
    const ok = await loadCourses(city);
    expect(ok).toHaveLength(1);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("uses data_version query", async () => {
    const mock = serve();
    await loadGraph(city);
    await loadPois(city);
    await loadSegments(city);
    await loadIndex();
    const urls = mock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toMatch(/data\/fakecity\/graph\.json\?v=abc123def456$/);
    expect(urls[1]).toMatch(/data\/fakecity\/pois\.geojson\?v=abc123def456$/);
    expect(urls[2]).toMatch(/data\/fakecity\/segments\.geojson\?v=abc123def456$/);
    expect(urls[3]).toMatch(/data\/cities\.json\?v=.+/);
  });

  it("reports network errors with null status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const err = (await loadGraph(city).catch((e: unknown) => e)) as DataError;
    expect(err).toBeInstanceOf(DataError);
    expect(err.status).toBeNull();
  });

  it("reports invalid json as DataError", async () => {
    serve({ "fakecity/graph.json": () => new Response("<html>", { status: 200 }) });
    const err = (await loadGraph(city).catch((e: unknown) => e)) as DataError;
    expect(err).toBeInstanceOf(DataError);
    expect(err.status).toBe(200);
  });

  it("parses unreachable course fixture", async () => {
    serve();
    const courses: Course[] = await loadCourses(city);
    const c = courses[0]!;
    expect(c.reachable).toBe(false);
    expect(c.routes.accessible).toBeNull();
    expect(c.comparison).toBeNull();
    expect(c.blocked_at).toEqual([2.33, 48.86]);
    expect(c.routes.shortest.profile[0]).toHaveLength(3);
  });
});

describe("bounded city cache", () => {
  const other = (id: string) => ({ ...city, id });
  const body = (url: string): string => {
    if (url.includes("graph.json")) return read("fakecity/graph.json");
    if (url.includes("segments")) return read("fakecity/segments.geojson");
    return read("fakecity/courses.json");
  };
  function serveAny() {
    const mock = vi.fn(async (input: RequestInfo | URL) => new Response(body(String(input)), { status: 200 }));
    vi.stubGlobal("fetch", mock);
    return mock;
  }
  const hits = (mock: ReturnType<typeof serveAny>, id: string): number =>
    mock.mock.calls.filter((c) => String(c[0]).includes(`/data/${id}/segments`)).length;

  it("keeps only the two most recently used cities", async () => {
    const mock = serveAny();
    const [a, b, c] = [other("a"), other("b"), other("c")];
    await loadSegments(a);
    await loadSegments(b);
    await loadSegments(a); // a를 최근으로 올린다
    expect(hits(mock, "a")).toBe(1);
    await loadSegments(c); // b가 밀려난다
    await loadSegments(a);
    expect(hits(mock, "a")).toBe(1);
    await loadSegments(b);
    expect(hits(mock, "b")).toBe(2);
  });

  it("opening a third city evicts the first city's files and derived caches", async () => {
    const mock = serveAny();
    const [a, b, c] = [other("a"), other("b"), other("c")];
    const gj = await loadGraph(a);
    const fc = await loadSegments(a);
    const g1 = cachedGraph(a.id, a.data_version, gj);
    const p1 = cachedSegProps(a.id, a.data_version, fc.features);
    expect(cachedGraph(a.id, a.data_version, gj)).toBe(g1);
    await loadSegments(b);
    await loadSegments(c);
    expect(cachedGraph(a.id, a.data_version, gj)).not.toBe(g1);
    expect(cachedSegProps(a.id, a.data_version, fc.features)).not.toBe(p1);
    await loadGraph(a);
    expect(mock.mock.calls.filter((x) => String(x[0]).includes("/data/a/graph")).length).toBe(2);
  });

  it("aborts a pending request after its last consumer leaves, but not before", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((_u: unknown, init?: RequestInit) => {
          seen = init?.signal ?? undefined;
          return new Promise<Response>((_res, rej) => seen?.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))));
        }),
      );
      const v1 = new AbortController();
      const v2 = new AbortController();
      const p = loadSegments(city, v1.signal);
      p.catch(() => {});
      loadSegments(city, v2.signal).catch(() => {});
      v1.abort();
      vi.advanceTimersByTime(ABORT_GRACE_MS + 10);
      expect(seen?.aborted).toBe(false); // 아직 소비자가 있다
      v2.abort();
      vi.advanceTimersByTime(ABORT_GRACE_MS + 10);
      expect(seen?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not abort when a new consumer arrives within the grace period", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((_u: unknown, init?: RequestInit) => {
          seen = init?.signal ?? undefined;
          return new Promise<Response>(() => {});
        }),
      );
      const v1 = new AbortController();
      loadSegments(city, v1.signal).catch(() => {});
      v1.abort();
      loadSegments(city, new AbortController().signal).catch(() => {});
      vi.advanceTimersByTime(ABORT_GRACE_MS + 10);
      expect(seen?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
