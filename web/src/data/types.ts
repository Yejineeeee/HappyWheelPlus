export interface Weights {
  slope: number;
  surface: number;
  kerb: number;
  uncertainty: number;
}

export type PoiKind = "toilet" | "elevator" | "bench" | "fountain";
export type SurfaceClass = "smooth" | "paving" | "compacted" | "cobble" | "unpaved" | "unknown";

export interface CityEntry {
  id: string;
  name_ko: string;
  country_ko: string;
  center: [number, number];
  radius_m: number;
  data_version: string;
  course_count: number;
  metrics: {
    mean_score: number;
    blocked_share: number;
    surface_coverage: number;
    slope_coverage: number;
    network_km: number;
    area_km2: number;
    poi_per_km2: Record<PoiKind, number>;
    surface_mix: Record<SurfaceClass, number>;
  };
}

export interface CityIndex {
  generated_at: string;
  weights_default: Weights;
  alpha: number;
  cities: CityEntry[];
}

/** 간선 행: [u, v, len, p_slope, p_surface, p_kerb, p_unc, flags]. seg_id는 행 번호. */
export type EdgeRow = [number, number, number, number, number, number, number, number];

export interface GraphJson {
  nodes: [number, number][];
  elev: (number | null)[];
  edges: EdgeRow[];
}

export const FLAG = { BLOCKED: 1, STEPS: 2, WC_YES: 4, SPAN: 8 } as const;

export interface SegmentProps {
  len: number;
  p_slope: number;
  p_surface: number;
  p_kerb: number;
  p_unc: number;
  grade_max: number | null;
  surface_class: SurfaceClass;
  wc_yes: boolean;
  steps: boolean;
  blocked: boolean;
  span: boolean;
  score: number | null;
}

export interface PoiProps {
  kind: PoiKind;
  name: string | null;
  wheelchair: string | null;
  osm_id: string;
}

export interface RouteMetrics {
  length_m: number;
  steps_count: number;
  max_grade_pct: number | null;
  steep_m: number;
  cobble_m: number;
  mean_score: number | null;
  toilets_300m: number;
}

export interface RouteData {
  coords: [number, number][];
  seg_ids: number[];
  metrics: RouteMetrics;
  /** [거리 m, 고도 m | null, 경사 % | null], 25 m 간격 */
  profile: [number, number | null, number | null][];
}

export interface Course {
  index: number;
  name: string;
  time_label: string;
  stops: { name: string; lon: number; lat: number }[];
  field: { difficulty: number; stars: number; note: string } | null;
  reachable: boolean;
  blocked_at: [number, number] | null;
  snap_max_m: number;
  approximate: boolean;
  routes: { shortest: RouteData; accessible: RouteData | null };
  comparison: { extra_m: number; steps_avoided: number } | null;
}
