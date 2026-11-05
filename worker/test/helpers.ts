import type { Env } from "../src/index";

export class FakeKV {
  store = new Map<string, string>();
  ttl = new Map<string, number | undefined>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
    this.ttl.set(key, opts?.expirationTtl);
  }
}

export function makeEnv(over: Partial<Env> = {}): Env & { LIMITS: FakeKV } {
  const kv = new FakeKV();
  return { OPENAI_API_KEY: "test-key", LIMITS: kv as unknown as KVNamespace, ...over } as Env & { LIMITS: FakeKV };
}

export const ORIGIN = "https://yejineeeee.github.io";

export function post(body: unknown, headers: Record<string, string> = {}, raw?: string): Request {
  return new Request("https://w.example/weights", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "1.1.1.1", ...headers },
    body: raw ?? JSON.stringify(body),
  });
}

export function openaiReply(content: unknown, extra: Record<string, unknown> = {}): Response {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return new Response(JSON.stringify({ choices: [{ message: { content: text, ...extra } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const GOOD = {
  weights: { slope: 2, surface: 1.5, kerb: 1, uncertainty: 0.5 },
  required_pois: ["toilet"],
  explanation: "경사를 더 피하도록 조정했어요.",
};
