import type { Env } from "./index";
import { POI_KINDS } from "./validate";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";

const num = { type: "number" } as const;

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    weights: {
      type: "object",
      properties: { slope: num, surface: num, kerb: num, uncertainty: num },
      required: ["slope", "surface", "kerb", "uncertainty"],
      additionalProperties: false,
    },
    required_pois: { type: "array", items: { type: "string", enum: [...POI_KINDS] } },
    explanation: { type: "string" },
  },
  required: ["weights", "required_pois", "explanation"],
  additionalProperties: false,
} as const;

// 실패(HTTP 오류, 거절, JSON 아님)는 예외로 던진다. 호출한 쪽에서 502로 바꾼다.
export async function askModel(env: Env, city: string, text: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 300,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(city, text) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "weights", strict: true, schema: RESPONSE_SCHEMA } },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: unknown; refusal?: unknown } }[] };
  const msg = data.choices?.[0]?.message;
  if (!msg || msg.refusal || typeof msg.content !== "string") throw new Error("openai unusable");
  return JSON.parse(msg.content);
}
