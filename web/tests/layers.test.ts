import { describe, expect, it } from "vitest";
import positron from "./fixtures/style-positron-layers.json";
import dark from "./fixtures/style-dark-layers.json";
import { segmentAnchor, POI_ICON_CSS_PX, POI_PIXEL_RATIO, SCORE_STOPS, poiCanvasSize, mapStyleUrl, scoreColorExpression } from "../src/map/style";

describe("map style helpers", () => {
  it("scoreColorExpression uses token stops in order", () => {
    const outer = scoreColorExpression("#123456") as unknown[];
    expect(outer.slice(0, 3)).toEqual(["case", ["<", ["get", "s"], 0], "#123456"]);
    const expr = outer[3] as unknown[];
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

  it("poi icon canvas is css size times pixel ratio", () => {
    expect(POI_ICON_CSS_PX).toBe(32);
    expect(poiCanvasSize()).toBe(POI_ICON_CSS_PX * POI_PIXEL_RATIO);
    expect(poiCanvasSize()).toBe(64);
  });
});

describe("segmentAnchor", () => {
  const idx = (l: { id: string }[], id: string) => l.findIndex((x) => x.id === id);
  const lastRoad = (l: { type: string; "source-layer"?: string }[]) =>
    l.reduce((n, x, i) => (x.type === "line" && x["source-layer"] === "transportation" ? i : n), -1);

  it("anchors right after the last transportation line in both styles", () => {
    for (const style of [positron, dark]) {
      const a = segmentAnchor(style);
      expect(a).toBeDefined();
      expect(idx(style, a!)).toBe(lastRoad(style) + 1);
    }
  });

  it("dark: road name labels stay above the anchor", () => {
    const a = idx(dark, segmentAnchor(dark)!);
    expect(idx(dark, "highway_name_other")).toBeGreaterThanOrEqual(a);
    expect(idx(dark, "highway_name_motorway")).toBeGreaterThanOrEqual(a);
    expect(idx(dark, "place_city")).toBeGreaterThanOrEqual(a);
  });

  it("positron: road names and place labels stay above the anchor", () => {
    const a = idx(positron, segmentAnchor(positron)!);
    for (const id of ["highway-name-minor", "highway-name-major", "label_city"]) {
      expect(idx(positron, id)).toBeGreaterThanOrEqual(a);
    }
  });

  it("falls back to the first symbol layer, then to undefined", () => {
    expect(segmentAnchor([{ id: "a", type: "fill" }, { id: "b", type: "symbol" }])).toBe("b");
    expect(segmentAnchor([{ id: "a", type: "fill" }])).toBeUndefined();
  });
});
