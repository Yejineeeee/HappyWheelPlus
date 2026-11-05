import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { GOOD, ORIGIN, makeEnv, openaiReply, post } from "./helpers";

const ctx = {} as ExecutionContext;
const call = (req: Request, env = makeEnv()) => worker.fetch(req, env, ctx);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => openaiReply(GOOD));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CORS와 라우팅", () => {
  it("허용 Origin preflight", async () => {
    const res = await call(new Request("https://w.example/weights", { method: "OPTIONS", headers: { Origin: ORIGIN } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
    expect(res.headers.get("Vary")).toBe("Origin");
  });
  it("비허용 Origin은 403, CORS 헤더 없음", async () => {
    for (const req of [
      new Request("https://w.example/weights", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
      post({ city: "paris", text: "a" }, { Origin: "https://evil.example" }),
    ]) {
      const res = await call(req);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("404와 405", async () => {
    expect((await call(new Request("https://w.example/other", { method: "POST", headers: { Origin: ORIGIN } }))).status).toBe(404);
    const res = await call(new Request("https://w.example/weights", { method: "GET", headers: { Origin: ORIGIN } }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
  it("ALLOWED_ORIGINS 환경변수", async () => {
    const env = makeEnv({ ALLOWED_ORIGINS: "https://a.example" });
    expect((await call(post({ city: "paris", text: "a" }), env)).status).toBe(403);
  });
});

describe("요청 검사", () => {
  it("400 bad_request (JSON 아님)", async () => {
    const res = await call(post(null, {}, "{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
  it("400 bad_request (빈 text), bad_city", async () => {
    expect(await (await call(post({ city: "paris", text: " " }))).json()).toEqual({ error: "bad_request" });
    const res = await call(post({ city: "seoul", text: "a" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_city" });
  });
  it("413 too_long (301자, 4KB 초과)", async () => {
    for (const req of [post({ city: "paris", text: "가".repeat(301) }), post({ city: "paris", text: "a", pad: "x".repeat(5000) })]) {
      const res = await call(req);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: "too_long" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("한도", () => {
  it("IP당 6번째 요청은 429", async () => {
    const env = makeEnv();
    for (let i = 0; i < 5; i++) expect((await call(post({ city: "paris", text: "a" }), env)).status).toBe(200);
    const res = await call(post({ city: "paris", text: "a" }), env);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
  it("전체 상한", async () => {
    const env = makeEnv({ DAILY_LIMIT_TOTAL: "2" });
    expect((await call(post({ city: "paris", text: "a" }, { "CF-Connecting-IP": "2.2.2.2" }), env)).status).toBe(200);
    expect((await call(post({ city: "paris", text: "a" }, { "CF-Connecting-IP": "3.3.3.3" }), env)).status).toBe(200);
    expect((await call(post({ city: "paris", text: "a" }, { "CF-Connecting-IP": "4.4.4.4" }), env)).status).toBe(429);
  });
  it("검사 실패 요청은 한도를 쓰지 않고, 502여도 차감 유지", async () => {
    const env = makeEnv();
    await call(post({ city: "seoul", text: "a" }), env);
    expect(env.LIMITS.store.size).toBe(0);
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 500 }));
    expect((await call(post({ city: "paris", text: "a" }), env)).status).toBe(502);
    expect(env.LIMITS.store.size).toBeGreaterThan(0);
  });
});

describe("성공과 계약", () => {
  it("200 정리된 결과", async () => {
    fetchMock.mockResolvedValueOnce(
      openaiReply({
        weights: { slope: 5, surface: -2, kerb: 1.26, uncertainty: 0.5 },
        required_pois: ["toilet", "cafe"],
        explanation: "  경사를 피해요  ",
      }),
    );
    const res = await call(post({ city: "paris", text: "휠체어라 경사가 싫어요" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(await res.json()).toEqual({
      weights: { slope: 2, surface: 0, kerb: 1.3, uncertainty: 0.5 },
      required_pois: ["toilet"],
      explanation: "경사를 피해요",
    });
  });
  it("OpenAI 호출 형식", async () => {
    await call(post({ city: "paris", text: "계단 싫어요" }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(JSON.stringify(body.messages)).toContain("계단 싫어요");
    expect(JSON.stringify(body.messages)).toContain("paris");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("웹 클라이언트가 기대하는 응답 모양 (200/429/413)", async () => {
    const ok = (await (await call(post({ city: "rome", text: "a" }))).json()) as Record<string, any>;
    expect(Object.keys(ok).sort()).toEqual(["explanation", "required_pois", "weights"]);
    for (const k of ["slope", "surface", "kerb", "uncertainty"]) {
      expect(typeof ok.weights[k]).toBe("number");
      expect(ok.weights[k]).toBeGreaterThanOrEqual(0);
      expect(ok.weights[k]).toBeLessThanOrEqual(2);
    }
    expect(Array.isArray(ok.required_pois)).toBe(true);
    expect(typeof ok.explanation).toBe("string");
    const long = await call(post({ city: "rome", text: "가".repeat(301) }));
    expect([long.status, ((await long.json()) as { error: string }).error]).toEqual([413, "too_long"]);
    const env = makeEnv({ DAILY_LIMIT_PER_IP: "0" });
    expect((await call(post({ city: "rome", text: "a" }), env)).status).toBe(429);
  });
});

describe("업스트림 실패", () => {
  const cases: [string, () => Response | Promise<never>][] = [
    ["OpenAI 500", () => new Response("err", { status: 500 })],
    ["시간 초과", () => Promise.reject(new DOMException("t", "TimeoutError"))],
    ["JSON 아닌 응답", () => new Response("<html>", { status: 200 })],
    ["content가 JSON 아님", () => openaiReply("hello")],
    ["refusal", () => new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: "no" } }] }), { status: 200 })],
    ["형식 불량", () => openaiReply({ weights: { slope: 1 } })],
  ];
  for (const [name, make] of cases) {
    it(`502: ${name}`, async () => {
      fetchMock.mockImplementationOnce(async () => make());
      const res = await call(post({ city: "paris", text: "a" }));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "upstream" });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    });
  }
});

describe("서버 오류와 로그", () => {
  it("키 없으면 500", async () => {
    const res = await call(post({ city: "paris", text: "a" }), makeEnv({ OPENAI_API_KEY: "" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("사용자 문장과 키는 로그에 남지 않는다", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await call(post({ city: "paris", text: "비밀문장입니다" }));
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 500 }));
    await call(post({ city: "paris", text: "비밀문장입니다" }));
    const all = JSON.stringify([...log.mock.calls, ...err.mock.calls, ...warn.mock.calls]);
    expect(log).toHaveBeenCalled();
    expect(all).not.toContain("비밀문장");
    expect(all).not.toContain("test-key");
  });
});

describe("오류 처리 보강", () => {
  it("KV get 실패는 503, CORS 있고 OpenAI 호출 없음", async () => {
    const env = makeEnv();
    env.LIMITS.get = async () => {
      throw new Error("kv down");
    };
    const res = await call(post({ city: "paris", text: "a" }), env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "server" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("KV put 실패(쓰기 제한)도 503", async () => {
    const env = makeEnv();
    env.LIMITS.put = async () => {
      throw new Error("429 too many writes");
    };
    const res = await call(post({ city: "paris", text: "a" }), env);
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("예상 못한 예외는 500, CORS 있고 오류 문구 없음", async () => {
    const req = post({ city: "paris", text: "a" });
    Object.defineProperty(req, "text", {
      value: async () => {
        throw new Error("secret detail");
      },
    });
    const res = await call(req);
    expect(res.status).toBe(500);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(await res.text()).toBe(JSON.stringify({ error: "server" }));
  });
  it("Content-Length 5000이면 본문을 읽지 않고 413", async () => {
    const req = post({ city: "paris", text: "a" }, { "Content-Length": "5000" });
    const spy = vi.fn(async () => "");
    Object.defineProperty(req, "text", { value: spy });
    const res = await call(req);
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });
  it("프롬프트의 따옴표 세 개는 치환된다", async () => {
    await call(post({ city: "paris", text: 'a """ b' }));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    const user = body.messages[1].content as string;
    expect(user).toContain("a '' b");
    expect(user.match(/"""/g)?.length).toBe(2);
  });
});
