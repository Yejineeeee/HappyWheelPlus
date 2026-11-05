import type { PoiKind, Weights } from "../data/types";

export interface AiRequest {
  city: string;
  text: string;
}
export interface AiResponse {
  weights: Weights;
  required_pois: PoiKind[];
  explanation: string;
}
export type AiError = "disabled" | "too_long" | "rate_limited" | "network" | "bad_response";
export type AiResult = { ok: true; value: AiResponse } | { ok: false; error: AiError };

export const AI_MAX_CHARS = 300;
export const AI_TIMEOUT_MS = 15000;
const EXPLANATION_MAX = 100;
const KINDS: PoiKind[] = ["toilet", "elevator", "bench", "fountain"];
const WEIGHT_KEYS: (keyof Weights)[] = ["slope", "surface", "kerb", "uncertainty"];

function endpoint(): string {
  const v = import.meta.env.VITE_AI_ENDPOINT;
  return typeof v === "string" ? v.trim() : "";
}

export function aiEnabled(): boolean {
  return endpoint() !== "";
}

function parse(data: unknown): AiResponse | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const w = d.weights;
  if (typeof w !== "object" || w === null) return null;
  const weights = {} as Weights;
  for (const k of WEIGHT_KEYS) {
    const raw = (w as Record<string, unknown>)[k];
    if (typeof raw !== "number" || Number.isNaN(raw)) return null;
    const clamped = Math.min(2, Math.max(0, raw));
    // 슬라이더 단계(0.5)에 맞춰 반올림한다.
    weights[k] = Math.round(clamped * 2) / 2;
  }
  const pois = Array.isArray(d.required_pois) ? d.required_pois : [];
  const required = KINDS.filter((k) => pois.includes(k));
  const explanation = typeof d.explanation === "string" ? d.explanation.trim().slice(0, EXPLANATION_MAX) : "";
  return { weights, required_pois: required, explanation };
}

export async function requestWeights(req: AiRequest, signal?: AbortSignal): Promise<AiResult> {
  const base = endpoint();
  if (!base) return { ok: false, error: "disabled" };
  if (req.text.length > AI_MAX_CHARS) return { ok: false, error: "too_long" };
  if (signal?.aborted) return { ok: false, error: "network" };

  const ctl = new AbortController();
  const onAbort = (): void => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctl.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/weights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: req.city, text: req.text }),
      signal: ctl.signal,
    });
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (res.status === 400 || res.status === 413) {
      let code: unknown;
      try {
        code = ((await res.json()) as { error?: unknown }).error;
      } catch {
        code = undefined;
      }
      return { ok: false, error: code === "too_long" ? "too_long" : "bad_response" };
    }
    if (!res.ok) return { ok: false, error: "network" };
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { ok: false, error: "bad_response" };
    }
    const value = parse(data);
    return value ? { ok: true, value } : { ok: false, error: "bad_response" };
  } catch {
    return { ok: false, error: "network" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
