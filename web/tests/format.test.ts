import { describe, expect, it } from "vitest";
import { fmtDelta, fmtM, fmtPct, scoreLabel } from "../src/ui/format";

describe("format", () => {
  it("fmtM", () => {
    expect(fmtM(950)).toBe("950m");
    expect(fmtM(949.6)).toBe("950m");
    expect(fmtM(1000)).toBe("1.0km");
    expect(fmtM(1234)).toBe("1.2km");
  });
  it("fmtPct", () => {
    expect(fmtPct(null)).toBe("–");
    expect(fmtPct(6.04)).toBe("6.0%");
    expect(fmtPct(0)).toBe("0.0%");
  });
  it("fmtDelta", () => {
    expect(fmtDelta(242.5)).toBe("+243m");
    expect(fmtDelta(-5)).toBe("−5m");
    expect(fmtDelta(0)).toBe("0m");
    expect(fmtDelta(0.2)).toBe("0m");
    expect(fmtDelta(-0.2)).toBe("0m");
  });
  it("scoreLabel", () => {
    expect(scoreLabel(80)).toBe("좋음");
    expect(scoreLabel(79.9)).toBe("보통");
    expect(scoreLabel(55)).toBe("보통");
    expect(scoreLabel(54)).toBe("어려움");
    expect(scoreLabel(null)).toBe("지나갈 수 없는 길");
  });
});
