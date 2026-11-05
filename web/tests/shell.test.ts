import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOME_CRUMB, initialTheme, mountShell } from "../src/ui/shell";

describe("shell header and page head", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    location.hash = "";
  });
  afterEach(() => {
    location.hash = "";
  });

  it("header has the text logo, two text links and the theme button, without back button or page title", () => {
    const shell = mountShell(document.getElementById("app")!);
    const header = shell.header;
    const brand = header.querySelector<HTMLAnchorElement>("a.brand")!;
    expect(brand.textContent).toBe("HappyWheel+");
    expect(brand.getAttribute("href")).toBe("#/");
    const links = [...header.querySelectorAll<HTMLAnchorElement>(".header-link")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#/compare", "#/about"]);
    expect(links.map((a) => a.querySelector(".label-long")!.textContent)).toEqual(["도시 비교", "분석 방법"]);
    expect(links.map((a) => a.querySelector(".label-short")!.textContent)).toEqual(["비교", "방법"]);
    expect(header.querySelector('button[aria-label="테마 바꾸기"]')).not.toBeNull();
    expect(header.querySelector('[aria-label="뒤로"]')).toBeNull();
    expect(header.querySelector("h1")).toBeNull();
  });

  it("marks the current page link with aria-current", async () => {
    const shell = mountShell(document.getElementById("app")!);
    location.hash = "#/compare";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const [compare, about] = [...shell.header.querySelectorAll(".header-link")];
    expect(compare.getAttribute("aria-current")).toBe("page");
    expect(about.hasAttribute("aria-current")).toBe(false);
    location.hash = "#/about";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(compare.hasAttribute("aria-current")).toBe(false);
    expect(about.getAttribute("aria-current")).toBe("page");
  });

  it("renders breadcrumb links and the page title at the top of the panel", () => {
    const shell = mountShell(document.getElementById("app")!);
    shell.setTitle("에펠 코스", [{ label: "파리", href: "#/paris" }]);
    const crumbs = [...shell.pageHead.querySelectorAll<HTMLAnchorElement>(".crumbs a")];
    expect(crumbs.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["파리", "#/paris"]]);
    expect(shell.pageHead.querySelector("h1")!.textContent).toBe("에펠 코스");
    expect(document.title).toBe("에펠 코스 · HappyWheel+");

    shell.setTitle("길안내", [{ label: "파리", href: "#/paris" }, { label: "에펠 코스", href: "#/paris/0" }], "에펠 코스 길안내");
    expect(shell.pageHead.querySelectorAll(".crumbs a").length).toBe(2);
    expect(document.title).toBe("에펠 코스 길안내 · HappyWheel+");

    shell.setTitle("분석 방법", [HOME_CRUMB]);
    expect(shell.pageHead.querySelector(".crumbs a")!.getAttribute("href")).toBe("#/");
  });

  it("home has no breadcrumb and only a screen-reader title", () => {
    const shell = mountShell(document.getElementById("app")!);
    shell.setTitle(null);
    expect(shell.pageHead.querySelector(".crumbs")).toBeNull();
    expect(shell.pageHead.querySelector("h1")!.classList.contains("visually-hidden")).toBe(true);
    expect(document.title).toBe("HappyWheel+");
  });

  it("sets the layout on the app body", () => {
    const shell = mountShell(document.getElementById("app")!);
    shell.setLayout("reading");
    expect(document.querySelector<HTMLElement>(".app-body")!.dataset.layout).toBe("reading");
  });
});

describe("initial theme", () => {
  const orig = window.matchMedia;
  afterEach(() => {
    window.matchMedia = orig;
    localStorage.clear();
  });

  it("starts light without a saved choice even when the system prefers dark", () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    localStorage.clear();
    expect(initialTheme()).toBe("light");
    localStorage.setItem("hw-theme", "dark");
    expect(initialTheme()).toBe("dark");
  });
});
