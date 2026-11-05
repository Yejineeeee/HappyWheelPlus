export const CITY_IDS = ["london", "paris", "lucerne", "bern", "interlaken", "milan", "venice", "florence", "rome"] as const;
export const POI_KINDS = ["toilet", "elevator", "bench", "fountain"] as const;
export type PoiKind = (typeof POI_KINDS)[number];

export const MAX_TEXT = 300;
export const MAX_BODY_BYTES = 4096;
const EXPLANATION_MAX = 100;
const WEIGHT_KEYS = ["slope", "surface", "kerb", "uncertainty"] as const;

export interface AiResponse {
  weights: Record<(typeof WEIGHT_KEYS)[number], number>;
  required_pois: PoiKind[];
  explanation: string;
}

export type ParseResult =
  | { ok: true; city: string; text: string }
  | { ok: false; status: 400 | 413; error: "bad_request" | "bad_city" | "too_long" };

export function parseRequest(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "bad_request" };
  }
  const { city, text } = body as Record<string, unknown>;
  if (typeof city !== "string" || typeof text !== "string") {
    return { ok: false, status: 400, error: "bad_request" };
  }
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, status: 400, error: "bad_request" };
  if (!(CITY_IDS as readonly string[]).includes(city)) return { ok: false, status: 400, error: "bad_city" };
  if (trimmed.length > MAX_TEXT) return { ok: false, status: 413, error: "too_long" };
  return { ok: true, city, text: trimmed };
}

export function cleanResponse(raw: unknown): AiResponse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const w = d.weights;
  if (typeof w !== "object" || w === null) return null;
  const weights = {} as AiResponse["weights"];
  for (const k of WEIGHT_KEYS) {
    const v = (w as Record<string, unknown>)[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    weights[k] = Math.round(Math.min(2, Math.max(0, v)) * 10) / 10;
  }
  if (typeof d.explanation !== "string") return null;
  const pois = Array.isArray(d.required_pois) ? d.required_pois : [];
  return {
    weights,
    required_pois: POI_KINDS.filter((k) => pois.includes(k)),
    explanation: d.explanation.trim().slice(0, EXPLANATION_MAX),
  };
}
