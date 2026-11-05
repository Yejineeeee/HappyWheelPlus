import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MAX_CHARS, aiEnabled, requestWeights } from "../src/ai/client";

const okBody = {
  weights: { slope: 1.5, surface: 1, kerb: 0.5, uncertainty: 1 },
  required_pois: ["toilet"],
  explanation: "경사를 더 피해요",
};
const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ask = () => requestWeights({ city: "x", text: "a" });

beforeEach(() => {
  vi.stubEnv("VITE_AI_ENDPOINT", "https://ai.example.test/");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ai client", () => {
  it("posts city and text only to /weights", async () => {
    const f = vi.fn().mockResolvedValue(reply(200, okBody));
    vi.stubGlobal("fetch", f);
    const r = await requestWeights({ city: "lucerne", text: "언덕이 싫어요" });
    expect(r).toEqual({ ok: true, value: okBody });
    expect(f.mock.calls[0][0]).toBe("https://ai.example.test/weights");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ city: "lucerne", text: "언덕이 싫어요" });
  });

  it("clamps out-of-range weights", async () => {
    const w = { slope: 9, surface: -3, kerb: 0.54, uncertainty: 1 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { ...okBody, weights: w })));
    const r = await ask();
    expect(r.ok && r.value.weights).toEqual({ slope: 2, surface: 0, kerb: 0.5, uncertainty: 1 });
  });

  it("rounds weights to the 0.5 slider steps", async () => {
    const w = { slope: 0.8, surface: 1.3, kerb: 0.2, uncertainty: 1.74 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { ...okBody, weights: w })));
    const r = await ask();
    expect(r.ok && r.value.weights).toEqual({ slope: 1, surface: 1.5, kerb: 0, uncertainty: 1.5 });
  });

  it("rejects NaN or missing weights as bad_response", async () => {
    const w = { slope: "a", surface: 1, kerb: 1, uncertainty: 1 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { ...okBody, weights: w })));
    expect(await ask()).toEqual({ ok: false, error: "bad_response" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { explanation: "" })));
    expect(await ask()).toEqual({ ok: false, error: "bad_response" });
  });

  it("drops unknown poi kinds and trims explanation", async () => {
    const body = { ...okBody, required_pois: ["bench", "sauna", "toilet"], explanation: "가".repeat(250) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, body)));
    const r = await ask();
    expect(r.ok && r.value.required_pois).toEqual(["toilet", "bench"]);
    expect(r.ok && r.value.explanation.length).toBe(100);
  });

  it("429 maps to rate_limited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(429, {})));
    expect(await ask()).toEqual({ ok: false, error: "rate_limited" });
  });

  it("400 maps to too_long only when the server says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(400, { error: "too_long" })));
    expect(await ask()).toEqual({ ok: false, error: "too_long" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(400, { error: "x" })));
    expect(await ask()).toEqual({ ok: false, error: "bad_response" });
  });

  it("other non-2xx and fetch failures map to network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(500, {})));
    expect(await ask()).toEqual({ ok: false, error: "network" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    expect(await ask()).toEqual({ ok: false, error: "network" });
  });

  it("timeout maps to network", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("a", "AbortError")))),
      ),
    );
    const p = ask();
    await vi.advanceTimersByTimeAsync(15001);
    expect(await p).toEqual({ ok: false, error: "network" });
  });

  it("disabled when endpoint empty", async () => {
    vi.stubEnv("VITE_AI_ENDPOINT", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(aiEnabled()).toBe(false);
    expect(await ask()).toEqual({ ok: false, error: "disabled" });
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects text over 300 chars without fetching", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(aiEnabled()).toBe(true);
    expect(await requestWeights({ city: "x", text: "가".repeat(AI_MAX_CHARS + 1) })).toEqual({ ok: false, error: "too_long" });
    expect(f).not.toHaveBeenCalled();
  });
});
