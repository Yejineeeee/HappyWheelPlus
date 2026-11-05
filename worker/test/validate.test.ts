import { describe, expect, it } from "vitest";
import { cleanResponse, parseRequest } from "../src/validate";

describe("parseRequest", () => {
  it("정상 요청", () => {
    expect(parseRequest({ city: "paris", text: "  경사 싫어요 " })).toEqual({ ok: true, city: "paris", text: "경사 싫어요" });
  });
  it("필드 누락·빈 text·객체 아님", () => {
    for (const b of [null, "x", [], {}, { city: "paris" }, { text: "a" }, { city: "paris", text: "   " }, { city: 1, text: "a" }]) {
      expect(parseRequest(b)).toEqual({ ok: false, status: 400, error: "bad_request" });
    }
  });
  it("알 수 없는 도시", () => {
    expect(parseRequest({ city: "seoul", text: "a" })).toEqual({ ok: false, status: 400, error: "bad_city" });
  });
  it("300자 초과", () => {
    expect(parseRequest({ city: "rome", text: "가".repeat(301) })).toEqual({ ok: false, status: 413, error: "too_long" });
    expect(parseRequest({ city: "rome", text: "가".repeat(300) }).ok).toBe(true);
  });
});

describe("cleanResponse", () => {
  it("범위 자르기와 0.1 반올림", () => {
    const r = cleanResponse({ weights: { slope: 3.4, surface: -1, kerb: 1.26, uncertainty: 0.04 }, required_pois: [], explanation: "x" });
    expect(r?.weights).toEqual({ slope: 2, surface: 0, kerb: 1.3, uncertainty: 0 });
  });
  it("모르는 편의시설 제거와 중복 제거", () => {
    const r = cleanResponse({ ...{ weights: { slope: 1, surface: 1, kerb: 1, uncertainty: 1 } }, required_pois: ["toilet", "cafe", "toilet", "bench"], explanation: "x" });
    expect(r?.required_pois).toEqual(["toilet", "bench"]);
  });
  it("설명 trim과 100자", () => {
    const r = cleanResponse({ weights: { slope: 1, surface: 1, kerb: 1, uncertainty: 1 }, required_pois: [], explanation: `  ${"가".repeat(150)} ` });
    expect(r?.explanation).toBe("가".repeat(100));
  });
  it("쓸 수 없으면 null", () => {
    expect(cleanResponse(null)).toBeNull();
    expect(cleanResponse({ weights: { slope: "a" }, required_pois: [], explanation: "" })).toBeNull();
    expect(cleanResponse({ weights: { slope: 1, surface: 1, kerb: 1, uncertainty: NaN }, required_pois: [], explanation: "" })).toBeNull();
    expect(cleanResponse({ weights: { slope: 1, surface: 1, kerb: 1, uncertainty: 1 }, required_pois: [], explanation: 3 })).toBeNull();
  });
});
