import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Course } from "../src/data/types";
import { cumulative, locate, pointAt } from "../src/nav/progress";
import { projectStops } from "../src/views/nav";

const courses: Course[] = JSON.parse(readFileSync(resolve(__dirname, "../public/data/lucerne/courses.json"), "utf8"));
const course = courses[0];
const coords = course.routes.accessible!.coords;
const cum = cumulative(coords);
const total = cum[cum.length - 1];

describe("lucerne out-and-back route", () => {
  it("noise-free walk keeps along monotonic and accurate through the turnaround", () => {
    let hint: number | undefined;
    let prev = -Infinity;
    let maxErr = 0;
    let maxBack = 0;
    for (let d = 0; d <= total; d += 5) {
      const p = locate(coords, cum, pointAt(coords, cum, d), hint);
      hint = p.alongM;
      maxBack = Math.max(maxBack, prev - p.alongM);
      prev = p.alongM;
      maxErr = Math.max(maxErr, Math.abs(p.alongM - d));
    }
    expect(maxBack).toBeLessThanOrEqual(1);
    expect(maxErr).toBeLessThan(10);
  });

  it("stop projections strictly increase", () => {
    const stops = projectStops(coords, cum, course.stops);
    for (let i = 1; i < stops.length; i++) expect(stops[i].atM).toBeGreaterThan(stops[i - 1].atM);
    expect(stops[stops.length - 1].atM).toBeGreaterThan(total - 30);
  });
});
