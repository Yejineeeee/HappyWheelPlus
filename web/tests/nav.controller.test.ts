import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startNav } from "../src/nav/controller";

const LINE: [number, number][] = [[8.3, 47.0], [8.3, 47.001], [8.3012, 47.001]];

function fakeGeo() {
  let ok: PositionCallback = () => {};
  let fail: PositionErrorCallback = () => {};
  const geo = {
    watchPosition: vi.fn((s: PositionCallback, e: PositionErrorCallback) => {
      ok = s;
      fail = e as PositionErrorCallback;
      return 7;
    }),
    clearWatch: vi.fn(),
  };
  return {
    geo: geo as unknown as Geolocation,
    raw: geo,
    fix: (lon: number, lat: number, heading: number | null = null) =>
      ok({ coords: { longitude: lon, latitude: lat, heading } } as GeolocationPosition),
    error: (code: number) => fail({ code, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("nav controller", () => {
  it("geolocation denied falls back to simulation prompt", () => {
    const g = fakeGeo();
    const need = vi.fn();
    startNav({ coords: LINE, source: "gps", geolocation: g.geo, onUpdate: vi.fn(), onNeedSimulation: need });
    g.error(1);
    expect(need).toHaveBeenCalledWith("denied");
    g.error(1);
    expect(need).toHaveBeenCalledTimes(1);
  });

  it("position unavailable and missing geolocation report unavailable", () => {
    const g = fakeGeo();
    const need = vi.fn();
    startNav({ coords: LINE, source: "gps", geolocation: g.geo, onUpdate: vi.fn(), onNeedSimulation: need });
    g.error(2);
    expect(need).toHaveBeenCalledWith("unavailable");

    const need2 = vi.fn();
    const saved = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
    startNav({ coords: LINE, source: "gps", onUpdate: vi.fn(), onNeedSimulation: need2 });
    if (saved) Object.defineProperty(navigator, "geolocation", saved);
    else delete (navigator as unknown as Record<string, unknown>).geolocation;
    expect(need2).toHaveBeenCalledWith("unavailable");
  });

  it("no first fix in 15 seconds reports unavailable", () => {
    const g = fakeGeo();
    const need = vi.fn();
    startNav({ coords: LINE, source: "gps", geolocation: g.geo, onUpdate: vi.fn(), onNeedSimulation: need });
    vi.advanceTimersByTime(14000);
    expect(need).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(need).toHaveBeenCalledWith("unavailable");
  });

  it("gps fix produces update with text and off-route flag; stop clears watch", () => {
    const g = fakeGeo();
    const onUpdate = vi.fn();
    const need = vi.fn();
    const h = startNav({ coords: LINE, source: "gps", geolocation: g.geo, onUpdate, onNeedSimulation: need });
    g.fix(8.3, 47.0003);
    const u = onUpdate.mock.calls[0][0];
    expect(u.offRoute).toBe(false);
    expect(u.text).toMatch(/오른쪽/);
    g.fix(8.3 + 0.002, 47.0003);
    expect(onUpdate.mock.calls[1][0].offRoute).toBe(true);
    vi.advanceTimersByTime(20000);
    expect(need).not.toHaveBeenCalled();
    h.stop();
    expect(g.raw.clearWatch).toHaveBeenCalledWith(7);
    g.fix(8.3, 47.0005);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("simulation source emits updates and stop ends the timer", () => {
    const onUpdate = vi.fn();
    const h = startNav({ coords: LINE, source: "sim", onUpdate, onNeedSimulation: vi.fn() });
    vi.advanceTimersByTime(2000);
    expect(onUpdate.mock.calls.length).toBeGreaterThan(5);
    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(last.progress.alongM).toBeCloseTo(2, 3);
    expect(last.heading).toBeCloseTo(0, 0);
    h.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
