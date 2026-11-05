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
    fix: (lon: number, lat: number, heading: number | null = null, accuracy = 5) =>
      ok({ coords: { longitude: lon, latitude: lat, heading, accuracy } } as GeolocationPosition),
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
    expect(onUpdate.mock.calls[1][0].offRoute).toBe(false); // 한 번만 벗어나면 경고하지 않는다
    g.fix(8.3 + 0.002, 47.0003);
    expect(onUpdate.mock.calls[2][0].offRoute).toBe(true);
    vi.advanceTimersByTime(20000);
    expect(need).not.toHaveBeenCalled();
    h.stop();
    expect(g.raw.clearWatch).toHaveBeenCalledWith(7);
    g.fix(8.3, 47.0005);
    expect(onUpdate).toHaveBeenCalledTimes(3);
  });

  it("accuracy is subtracted and off-route needs two consecutive fixes", () => {
    const g = fakeGeo();
    const onUpdate = vi.fn();
    startNav({ coords: LINE, source: "gps", geolocation: g.geo, onUpdate, onNeedSimulation: vi.fn() });
    const dLon = 60 / (111320 * Math.cos((47 * Math.PI) / 180));
    g.fix(8.3 + dLon, 47.0003, null, 80);
    g.fix(8.3 + dLon, 47.0003, null, 80);
    g.fix(8.3 + dLon, 47.0003, null, 80);
    expect(onUpdate.mock.calls.every((c) => c[0].offRoute === false)).toBe(true);
    g.fix(8.3 + dLon, 47.0003, null, 5);
    g.fix(8.3 + dLon, 47.0003, null, 5);
    expect(onUpdate.mock.calls.map((c) => c[0].offRoute).slice(3)).toEqual([false, true]);
  });

  it("timeout clears the watch", () => {
    const g = fakeGeo();
    startNav({ coords: LINE, source: "gps", geolocation: g.geo, onUpdate: vi.fn(), onNeedSimulation: vi.fn() });
    vi.advanceTimersByTime(16000);
    expect(g.raw.clearWatch).toHaveBeenCalledWith(7);
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
