import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute, type Route } from "../src/router";

describe("router", () => {
  it.each([
    ["", { name: "home" }],
    ["#/", { name: "home" }],
    ["#/compare", { name: "compare" }],
    ["#/about", { name: "about" }],
    ["#/paris", { name: "city", city: "paris" }],
    ["#/paris/1", { name: "course", city: "paris", course: 1 }],
    ["#/paris/0", { name: "course", city: "paris", course: 0 }],
    ["#/paris/1/nav", { name: "nav", city: "paris", course: 1 }],
    ["#/paris/x", { name: "notFound", path: "/paris/x" }],
    ["#/paris/-1", { name: "notFound", path: "/paris/-1" }],
    ["#/paris/1/foo", { name: "notFound", path: "/paris/1/foo" }],
    ["#/paris/1/nav/extra", { name: "notFound", path: "/paris/1/nav/extra" }],
  ] as [string, Route][])("parseRoute(%s)", (h, r) => {
    expect(parseRoute(h)).toEqual(r);
  });

  it("formatRoute round-trips", () => {
    const routes = [
      { name: "home" },
      { name: "compare" },
      { name: "about" },
      { name: "city", city: "paris" },
      { name: "course", city: "paris", course: 1 },
      { name: "nav", city: "paris", course: 2 },
    ] as const;
    for (const r of routes) expect(parseRoute(formatRoute(r))).toEqual(r);
    expect(formatRoute({ name: "course", city: "paris", course: 1 })).toBe("#/paris/1");
    expect(formatRoute({ name: "home" })).toBe("#/");
  });
});
