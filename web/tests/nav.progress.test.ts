import { describe, expect, it } from "vitest";
import { OFF_ROUTE_M, cumulative, headingAt, locate, splitAt } from "../src/nav/progress";

// 북쪽으로 약 222 m (위도 0.002도)
const LINE: [number, number][] = [
  [8.3, 47.0],
  [8.3, 47.001],
  [8.3, 47.002],
];

describe("progress", () => {
  it("locate on-route returns small offRoute and correct along", () => {
    const cum = cumulative(LINE);
    const total = cum[cum.length - 1];
    const p = locate(LINE, cum, [8.3, 47.0015]);
    expect(p.offRouteM).toBeLessThan(1);
    expect(p.alongM).toBeCloseTo(total * 0.75, 0);
    expect(p.remainingM).toBeCloseTo(total * 0.25, 0);
  });

  it("locate 60m away flags off route", () => {
    const cum = cumulative(LINE);
    // 동쪽으로 약 60 m
    const dLon = 60 / (111320 * Math.cos((47 * Math.PI) / 180));
    const p = locate(LINE, cum, [8.3 + dLon, 47.001]);
    expect(p.offRouteM).toBeGreaterThan(OFF_ROUTE_M);
    expect(p.offRouteM).toBeLessThan(65);
  });

  it("locate prefers the hinted part of a route that doubles back", () => {
    const loop: [number, number][] = [
      [8.3, 47.0],
      [8.3, 47.001],
      [8.3, 47.0],
    ];
    const cum = cumulative(loop);
    const mid = [8.3, 47.0005] as [number, number];
    const a = locate(loop, cum, mid, 20);
    const b = locate(loop, cum, mid, cum[2] - 20);
    expect(a.alongM).toBeLessThan(cum[1]);
    expect(b.alongM).toBeGreaterThan(cum[1]);
  });

  it("nextStopIndex follows stop positions", () => {
    const cum = cumulative(LINE);
    const stops = [0, 100, cum[2]];
    expect(locate(LINE, cum, [8.3, 47.0005], undefined, stops).nextStopIndex).toBe(1);
    expect(locate(LINE, cum, [8.3, 47.0015], undefined, stops).nextStopIndex).toBe(2);
  });

  it("splitAt and headingAt", () => {
    const cum = cumulative(LINE);
    const { done, rest } = splitAt(LINE, cum, 111.3);
    expect(done.length).toBe(done[done.length - 1] === rest[0] ? done.length : -1);
    expect(done[0]).toEqual(LINE[0]);
    expect(rest[rest.length - 1]).toEqual(LINE[2]);
    expect(headingAt(LINE, cum, 50)).toBeCloseTo(0, 0);
  });
});
