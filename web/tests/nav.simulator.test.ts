import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSimulation } from "../src/nav/simulator";

const LINE: [number, number][] = [[8.3, 47.0], [8.3, 47.002]]; // 약 222 m

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("simulator", () => {
  it("simulator advances 1m per second at 1x", () => {
    const along: number[] = [];
    const sim = startSimulation(LINE, 1, (_p, a) => along.push(a));
    expect(along[0]).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(along[along.length - 1]).toBeCloseTo(1, 5);
    vi.advanceTimersByTime(9000);
    expect(along[along.length - 1]).toBeCloseTo(10, 5);
    sim.stop();
  });

  it("4x moves faster, pause holds, resume continues", () => {
    let last = 0;
    const sim = startSimulation(LINE, 1, (_p, a) => (last = a));
    sim.setSpeed(4);
    vi.advanceTimersByTime(1000);
    expect(last).toBeCloseTo(4, 5);
    sim.pause();
    vi.advanceTimersByTime(5000);
    expect(last).toBeCloseTo(4, 5);
    sim.resume();
    vi.advanceTimersByTime(1000);
    expect(last).toBeCloseTo(8, 5);
    sim.stop();
  });

  it("stops by itself at the end and stop clears the timer", () => {
    let last = 0;
    const sim = startSimulation(LINE, 4, (_p, a) => (last = a), 215);
    vi.advanceTimersByTime(5000);
    expect(last).toBeGreaterThan(220);
    expect(vi.getTimerCount()).toBe(0);
    const again = startSimulation(LINE, 1, () => {});
    expect(vi.getTimerCount()).toBe(1);
    again.stop();
    expect(vi.getTimerCount()).toBe(0);
    sim.stop();
  });
});
