import type { FeatureCollection, LineString, Point } from "geojson";
import type { CityEntry, CityIndex, Course, GraphJson, PoiProps, SegmentProps } from "./types";

export class DataError extends Error {
  constructor(
    public file: string,
    public status: number | null,
    message?: string,
  ) {
    super(message ?? `데이터를 불러오지 못했어요: ${file}${status === null ? "" : ` (${status})`}`);
    this.name = "DataError";
  }
}

const cache = new Map<string, Promise<unknown>>();

function buildStamp(): string {
  return typeof __BUILD_STAMP__ !== "undefined" ? __BUILD_STAMP__ : "dev";
}

async function fetchJson<T>(url: string, file: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new DataError(file, null);
  }
  if (!res.ok) throw new DataError(file, res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw new DataError(file, res.status, `데이터 형식이 올바르지 않아요: ${file}`);
  }
}

function cached<T>(key: string, file: string, url: string): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const p = fetchJson<T>(url, file);
  cache.set(key, p);
  p.catch(() => {
    if (cache.get(key) === p) cache.delete(key);
  });
  return p;
}

function loadCityFile<T>(city: CityEntry, file: string): Promise<T> {
  return cached<T>(
    `${city.id}/${file}@${city.data_version}`,
    `${city.id}/${file}`,
    `${import.meta.env.BASE_URL}data/${city.id}/${file}?v=${city.data_version}`,
  );
}

export function loadIndex(): Promise<CityIndex> {
  const stamp = buildStamp();
  return cached<CityIndex>(
    `cities.json@${stamp}`,
    "cities.json",
    `${import.meta.env.BASE_URL}data/cities.json?v=${stamp}`,
  );
}

export function loadCourses(city: CityEntry): Promise<Course[]> {
  return loadCityFile<Course[]>(city, "courses.json");
}

export function loadSegments(
  city: CityEntry,
): Promise<FeatureCollection<LineString, SegmentProps>> {
  return loadCityFile(city, "segments.geojson");
}

export function loadGraph(city: CityEntry): Promise<GraphJson> {
  return loadCityFile<GraphJson>(city, "graph.json");
}

export function loadPois(
  city: CityEntry,
): Promise<FeatureCollection<Point, PoiProps>> {
  return loadCityFile(city, "pois.geojson");
}

/** 테스트용: 메모리 캐시를 비운다. */
export function clearDataCache(): void {
  cache.clear();
}
