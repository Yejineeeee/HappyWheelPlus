import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDataCache, DataError, loadCourses, loadGraph, loadIndex, loadPois, loadSegments } from "../src/data/load";
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
