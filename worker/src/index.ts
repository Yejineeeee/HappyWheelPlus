import { takeQuota } from "./limit";
import { askModel } from "./openai";
import { MAX_BODY_BYTES, cleanResponse, parseRequest } from "./validate";

export { CITY_IDS } from "./validate";

export interface Env {
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  DAILY_LIMIT_PER_IP?: string;
  DAILY_LIMIT_TOTAL?: string;
  LIMITS: KVNamespace;
}

const DEFAULT_ORIGINS = "https://yejineeeee.github.io,http://localhost:5173,http://localhost:4173";
const UPSTREAM_TIMEOUT_MS = 10000;

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function intVar(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function json(status: number, body: unknown, origin: string | null): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function log(status: number, city: string, length: number): void {
  console.log(JSON.stringify({ status, city, length }));
}

async function handleWeights(request: Request, env: Env, origin: string): Promise<Response> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    log(413, "-", raw.length);
    return json(413, { error: "too_long" }, origin);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    log(400, "-", raw.length);
    return json(400, { error: "bad_request" }, origin);
  }
  const parsed = parseRequest(body);
  if (!parsed.ok) {
    log(parsed.status, "-", raw.length);
    return json(parsed.status, { error: parsed.error }, origin);
  }
  const { city, text } = parsed;

  if (!env.OPENAI_API_KEY) {
    log(500, city, text.length);
    return json(500, { error: "server" }, origin);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ok = await takeQuota(
    env.LIMITS,
    ip,
    new Date(),
    intVar(env.DAILY_LIMIT_PER_IP, 5),
    intVar(env.DAILY_LIMIT_TOTAL, 300),
  );
  if (!ok) {
    log(429, city, text.length);
    return json(429, { error: "rate_limited" }, origin);
  }

  try {
    const result = cleanResponse(await askModel(env, city, text, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)));
    if (!result) throw new Error("unusable");
    log(200, city, text.length);
    return json(200, result, origin);
  } catch {
    log(502, city, text.length);
    return json(502, { error: "upstream" }, origin);
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (origin !== null && !allowedOrigins(env).includes(origin)) {
      return json(403, { error: "forbidden" }, null);
    }
    const { pathname } = new URL(request.url);
    if (pathname !== "/weights") return json(404, { error: "not_found" }, origin);

    if (request.method === "OPTIONS") {
      if (!origin) return json(403, { error: "forbidden" }, null);
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);
    if (!origin) return json(403, { error: "forbidden" }, null);
    return handleWeights(request, env, origin);
  },
};
