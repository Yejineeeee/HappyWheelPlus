import { describe, expect, it } from "vitest";
import { SCORE_STOPS, mapStyleUrl, scoreColorExpression } from "../src/map/style";

describe("map style helpers", () => {
  it("scoreColorExpression uses token stops in order", () => {
    const expr = scoreColorExpression() as unknown[];
    expect(expr.slice(0, 3)).toEqual(["interpolate", ["linear"], ["get", "s"]]);
    const flat = expr.slice(3);
    expect(flat).toEqual(SCORE_STOPS.flatMap(([v, c]) => [v, c]));
    expect(SCORE_STOPS.map(([v]) => v)).toEqual([0, 30, 55, 80, 100]);
    expect(SCORE_STOPS[0][1].toLowerCase()).toBe("#440154");
    expect(SCORE_STOPS[4][1].toLowerCase()).toBe("#7ad151");
  });

  it("mapStyleUrl returns positron for light and dark url for dark", () => {
    expect(mapStyleUrl("light")).toBe("https://tiles.openfreemap.org/styles/positron");
    expect(mapStyleUrl("dark")).toBe("https://tiles.openfreemap.org/styles/dark");
  });
});
