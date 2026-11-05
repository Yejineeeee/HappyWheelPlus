import { describe, expect, it, vi } from "vitest";
import { disposeProfileChart, profileChart } from "../src/ui/profileChart";
import { loadPlot, plotIfLoaded } from "../src/ui/plot";

describe("lazy plot library", () => {
  it("draws the profile chart after the library arrives, not before", async () => {
    expect(plotIfLoaded()).toBeNull();
    const node = profileChart([[0, 10, 1], [25, 12, 2], [50, 11, 3]]);
    document.body.append(node);
    // 라이브러리를 받기 전에도 요약 문장은 먼저 보인다.
    expect(node.textContent).toContain("최고 12m · 최저 10m");
    expect(node.querySelector("svg")).toBeNull();
    await loadPlot();
    await Promise.resolve();
    expect(node.querySelector("svg")).not.toBeNull();
    disposeProfileChart(node);
  });

  it("a disposed chart does not draw when the library arrives later", async () => {
    vi.resetModules();
    const chart = await import("../src/ui/profileChart");
    const lib = await import("../src/ui/plot");
    expect(lib.plotIfLoaded()).toBeNull();
    const node = chart.profileChart([[0, 1, 0], [25, 2, 3]]);
    chart.disposeProfileChart(node);
    await lib.loadPlot();
    await Promise.resolve();
    expect(node.querySelector("svg")).toBeNull();
  });
});
