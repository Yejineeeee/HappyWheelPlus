import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CityIndex } from "../src/data/types";

const INDEX = { generated_at: "x", alpha: 3, weights_default: {}, cities: [] } as unknown as CityIndex;

vi.mock("../src/data/load", () => ({ loadIndex: vi.fn(async () => INDEX) }));
vi.mock("../src/map/map", () => ({ createMap: vi.fn(() => ({ setTheme() {} })) }));
vi.mock("../src/map/layers", () => ({ clearCityLayers: vi.fn() }));

function fakeView(title: string | null) {
  return {
    mount(ctx: { shell: { setTitle(t: string | null): void } }) {
      ctx.shell.setTitle(title);
    },
    unmount() {},
  };
}
vi.mock("../src/views/home", () => ({ homeView: () => fakeView(null) }));
vi.mock("../src/views/city", () => ({ cityView: () => fakeView("루체른") }));
vi.mock("../src/views/course", () => ({ courseView: () => fakeView("호수 코스") }));
vi.mock("../src/views/nav", () => ({ navView: () => fakeView("길안내") }));
vi.mock("../src/views/compare", () => ({ compareView: () => fakeView("도시 비교") }));
vi.mock("../src/views/about", () => ({ aboutView: () => fakeView("분석 방법") }));
vi.mock("../src/views/notFound", () => ({ notFoundView: () => fakeView("찾을 수 없어요") }));

import { startApp } from "../src/app";

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const go = async (hash: string) => {
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await tick();
};

describe("focus after navigation", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    location.hash = "#/lucerne";
  });

  it("leaves focus alone on first load, then moves it to the new page heading on each route change", async () => {
    startApp(document.getElementById("app")!);
    await tick();
    const h1 = () => document.querySelector("h1")!;
    expect(h1().textContent).toBe("루체른");
    expect(document.activeElement).not.toBe(h1());

    await go("#/lucerne/0");
    expect(h1().textContent).toBe("호수 코스");
    expect(document.activeElement).toBe(h1());
    expect(h1().getAttribute("tabindex")).toBe("-1");

    await go("#/");
    expect(h1().classList.contains("visually-hidden")).toBe(true);
    expect(document.activeElement).toBe(h1());
  });
});
