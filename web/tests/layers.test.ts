import { describe, expect, it } from "vitest";
import positron from "./fixtures/style-positron-layers.json";
import dark from "./fixtures/style-dark-layers.json";
import { LABEL_GAP, pickLabels, segmentAnchor, POI_ICON_CSS_PX, POI_PIXEL_RATIO, SCORE_STOPS, poiCanvasSize, mapStyleUrl, scoreColorExpression } from "../src/map/style";

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

describe("pickLabels (home city label declutter)", () => {
  const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  it("moves a label that would cover a neighbouring city's dot to the left of its own dot", () => {
    // 스위스처럼 가까운 세 도시(점수 순 베른, 루체른, 인터라켄). 베른 라벨 오른쪽 자리는 루체른 점을 덮는다.
    const dots = [box(900, 405, 16, 16), box(940, 398, 16, 16), box(920, 423, 16, 16)];
    const labels = [box(922, 402, 60, 22), box(962, 395, 60, 22), box(942, 420, 60, 22)];
    const side = pickLabels(labels, dots);
    expect(side[0]).toBe("left");
    expect(side[1]).toBe("right");
    // 보이는 라벨은 서로, 그리고 다른 도시의 점과 겹치지 않는다
    const placed = labels.map((r, i) =>
      side[i] === "left" ? { ...r, right: dots[i].left - LABEL_GAP, left: dots[i].left - LABEL_GAP - r.width } : r,
    );
    placed.forEach((r, i) => {
      if (side[i] === null) return;
      dots.forEach((d, j) => j !== i && expect(overlaps(r, d)).toBe(false));
      placed.forEach((q, j) => j !== i && side[j] !== null && expect(overlaps(r, q)).toBe(false));
    });
  });

  it("works with DOMRect-like inputs whose fields are prototype getters", () => {
    class Rect {
      constructor(private x: number, private y: number, private w: number, private h: number) {}
      get left() { return this.x; }
      get top() { return this.y; }
      get right() { return this.x + this.w; }
      get bottom() { return this.y + this.h; }
      get width() { return this.w; }
      get height() { return this.h; }
    }
    const dots = [new Rect(100, 100, 16, 16), new Rect(140, 100, 16, 16), new Rect(180, 100, 16, 16)];
    const labels = [new Rect(122, 97, 60, 22), new Rect(162, 97, 60, 22), new Rect(202, 97, 60, 22)];
    expect(pickLabels(labels, dots)).toEqual(["left", null, "right"]);
  });

  it("keeps labels that are apart and ignores the own dot", () => {
    const dots = [box(0, 0, 16, 16), box(500, 0, 16, 16)];
    const labels = [box(10, 0, 60, 22), box(510, 0, 60, 22)];
    expect(pickLabels(labels, dots)).toEqual(["right", "right"]);
  });

  it("hides a label when both sides collide, and leaves unmeasured labels alone", () => {
    // 한 줄로 촘촘한 세 도시: 가운데 도시는 오른쪽이 이웃 점, 왼쪽이 첫 도시 점과 겹친다
    const dots = [box(100, 100, 16, 16), box(140, 100, 16, 16), box(180, 100, 16, 16)];
    const labels = [box(122, 97, 60, 22), box(162, 97, 60, 22), box(202, 97, 60, 22)];
    expect(pickLabels(labels, dots)).toEqual(["left", null, "right"]);
    expect(pickLabels([box(0, 0, 0, 0)], [box(0, 0, 16, 16)])).toEqual(["right"]);
  });
});
