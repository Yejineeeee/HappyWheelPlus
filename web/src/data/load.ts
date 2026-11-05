import type { FeatureCollection, LineString, Point } from "geojson";
import { emitCityEvict } from "./evict";
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

interface Entry {
  p: Promise<unknown>;
  ctl: AbortController;
  /** 신호를 넘긴 소비자 수. 신호 없이 요청한 소비자가 있으면 중단하지 않는다. */
  users: number;
  pinned: boolean;
  settled: boolean;
}

const cache = new Map<string, Entry>();
/** 최근에 쓴 도시 id(오래된 순). 메모리에는 MAX_CITIES개 도시의 데이터만 둔다. */
const recent: string[] = [];
export const MAX_CITIES = 2;
/** 마지막 소비자가 떠난 뒤 이 시간 안에 다시 요청하지 않으면 내려받기를 중단한다. */
export const ABORT_GRACE_MS = 1500;

function evictCity(id: string): void {
  for (const [key, e] of [...cache]) {
    if (!key.startsWith(`${id}/`)) continue;
    if (!e.settled) e.ctl.abort();
    cache.delete(key);
  }
  emitCityEvict(id);
}

function touchCity(id: string): void {
  const i = recent.indexOf(id);
  if (i >= 0) recent.splice(i, 1);
  recent.push(id);
  while (recent.length > MAX_CITIES) evictCity(recent.shift()!);
}

function buildStamp(): string {
  return typeof __BUILD_STAMP__ !== "undefined" ? __BUILD_STAMP__ : "dev";
}

async function fetchJson<T>(url: string, file: string, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
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

function cached<T>(key: string, file: string, url: string, signal?: AbortSignal): Promise<T> {
  let found = cache.get(key);
  if (!found) {
    const ctl = new AbortController();
    const made: Entry = { p: fetchJson<T>(url, file, ctl.signal), ctl, users: 0, pinned: false, settled: false };
    found = made;
    cache.set(key, made);
    made.p.then(
      () => {
        made.settled = true;
      },
      () => {
        made.settled = true;
        if (cache.get(key) === made) cache.delete(key);
      },
    );
  }
  const entry = found;
  if (!signal) entry.pinned = true;
  else {
    entry.users++;
    const release = (): void => {
      entry.users--;
      if (entry.users > 0 || entry.pinned || entry.settled) return;
      // 화면이 바뀌며 곧 같은 데이터를 다시 요청할 수 있어 잠시 기다렸다가 중단한다.
      setTimeout(() => {
        if (entry.users > 0 || entry.pinned || entry.settled) return;
        entry.ctl.abort();
        if (cache.get(key) === entry) cache.delete(key);
      }, ABORT_GRACE_MS);
    };
    if (signal.aborted) release();
    else signal.addEventListener("abort", release, { once: true });
  }
  return entry.p as Promise<T>;
}

function loadCityFile<T>(city: CityEntry, file: string, signal?: AbortSignal): Promise<T> {
  touchCity(city.id);
  return cached<T>(
    `${city.id}/${file}@${city.data_version}`,
    `${city.id}/${file}`,
    `${import.meta.env.BASE_URL}data/${city.id}/${file}?v=${city.data_version}`,
    signal,
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

export function loadCourses(city: CityEntry, signal?: AbortSignal): Promise<Course[]> {
  return loadCityFile<Course[]>(city, "courses.json", signal);
}

export function loadSegments(
  city: CityEntry,
  signal?: AbortSignal,
): Promise<FeatureCollection<LineString, SegmentProps>> {
  return loadCityFile(city, "segments.geojson", signal);
}

export function loadGraph(city: CityEntry, signal?: AbortSignal): Promise<GraphJson> {
  return loadCityFile<GraphJson>(city, "graph.json", signal);
}

export function loadPois(
  city: CityEntry,
  signal?: AbortSignal,
): Promise<FeatureCollection<Point, PoiProps>> {
  return loadCityFile(city, "pois.geojson", signal);
}

/** 테스트용: 메모리 캐시를 비운다. */
export function clearDataCache(): void {
  for (const e of cache.values()) if (!e.settled) e.ctl.abort();
  cache.clear();
  recent.length = 0;
}
