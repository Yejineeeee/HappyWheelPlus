import { describe, expect, it } from "vitest";
import type { SegmentProps } from "../src/data/types";
import { buildInstructions, nextInstructionText, type Instruction } from "../src/nav/instructions";
import { cumulative } from "../src/nav/progress";

function props(over: Partial<SegmentProps> = {}): SegmentProps {
  return {
    len: 100, p_slope: 0, p_surface: 0, p_kerb: 0, p_unc: 0, grade_max: 1, surface_class: "smooth",
    wc_yes: false, steps: false, blocked: false, span: false, score: 90, ...over,
  };
}

// 북쪽 약 111 m 후 동쪽으로 약 82 m (오른쪽 회전)
const RIGHT: [number, number][] = [[8.3, 47.0], [8.3, 47.001], [8.3012, 47.001]];
const LEFT: [number, number][] = [[8.3, 47.0], [8.3, 47.001], [8.2988, 47.001]];

describe("instructions", () => {
  it("buildInstructions detects left turn at 90 degree corner", () => {
    const ins = buildInstructions(LEFT, [], [{ name: "끝", atM: cumulative(LEFT)[2] }]);
    const turn = ins.find((i) => i.kind === "turn-left");
    expect(turn).toBeDefined();
    expect(Math.abs(turn!.atM - 111)).toBeLessThan(8);
    expect(ins.some((i) => i.kind === "turn-right")).toBe(false);
  });

  it("detects right turn", () => {
    const ins = buildInstructions(RIGHT, [], []);
    expect(ins.some((i) => i.kind === "turn-right")).toBe(true);
  });

  it("buildInstructions merges slope start with turn at same spot", () => {
    const cum = cumulative(RIGHT);
    const segs = [
      { segId: 0, startM: 0, endM: cum[1], props: props() },
      { segId: 1, startM: cum[1], endM: cum[2], props: props({ grade_max: 7.4 }) },
    ];
    const ins = buildInstructions(RIGHT, segs, []);
    const merged = ins.find((i) => i.text.includes("경사 7% 구간 시작"));
    expect(merged).toBeDefined();
    expect(merged!.kind).toBe("turn-right");
    expect(merged!.text).toBe("오른쪽, 경사 7% 구간 시작");
  });

  it("feature entries fire once on entering and the last stop is arrive", () => {
    const line: [number, number][] = [[8.3, 47.0], [8.3, 47.004]];
    const cum = cumulative(line);
    const q = cum[1] / 4;
    const segs = [
      { segId: 0, startM: 0, endM: q, props: props() },
      { segId: 1, startM: q, endM: 2 * q, props: props({ surface_class: "cobble", p_kerb: 0.5 }) },
      { segId: 2, startM: 2 * q, endM: 3 * q, props: props({ surface_class: "cobble", p_kerb: 0.5 }) },
      { segId: 3, startM: 3 * q, endM: 4 * q, props: props({ span: true }) },
    ];
    const ins = buildInstructions(line, segs, [
      { name: "시작", atM: 0 },
      { name: "광장", atM: 2 * q },
      { name: "호수", atM: cum[1] },
    ]);
    expect(ins.filter((i) => i.text.includes("돌길 구간 시작"))).toHaveLength(1);
    expect(ins.filter((i) => i.text.includes("높은 연석 주의"))).toHaveLength(1);
    expect(ins.some((i) => i.text.includes("다리 구간"))).toBe(true);
    expect(ins.some((i) => i.text.includes("광장 도착"))).toBe(true);
    expect(ins.some((i) => i.text.includes("시작 도착"))).toBe(false);
    const last = ins[ins.length - 1];
    expect(last.kind).toBe("arrive");
    expect(last.text).toBe("목적지 호수 도착");
  });

  it("nextInstructionText formats distance, merges, and rounds", () => {
    const ins: Instruction[] = [
      { atM: 120, kind: "turn-left", text: "왼쪽, 경사 7% 구간 시작" },
      { atM: 300, kind: "arrive", text: "목적지 호수 도착" },
    ];
    expect(nextInstructionText(ins, 0)).toBe("120m 앞 왼쪽, 경사 7% 구간 시작");
    expect(nextInstructionText(ins, 3)).toBe("120m 앞 왼쪽, 경사 7% 구간 시작");
    expect(nextInstructionText(ins, 108)).toBe("곧 왼쪽, 경사 7% 구간 시작");
    expect(nextInstructionText(ins, 200)).toBe("목적지 호수 도착");
  });

  it("nextInstructionText at end says arrived", () => {
    const ins: Instruction[] = [{ atM: 300, kind: "arrive", text: "목적지 호수 도착" }];
    expect(nextInstructionText(ins, 400)).toBe("목적지에 도착했어요");
    expect(nextInstructionText([], 0)).toBe("목적지에 도착했어요");
  });

  it("U-turn says turn back and short jogs are suppressed", () => {
    // 북쪽 111 m 후 다시 남쪽으로
    const uturn: [number, number][] = [[8.3, 47.0], [8.3, 47.001], [8.30001, 47.0]];
    const ins = buildInstructions(uturn, [], []);
    const t = ins.find((i) => i.kind.startsWith("turn"));
    expect(t?.text).toBe("되돌아가요");
    expect(nextInstructionText([{ atM: 130, kind: "turn-right", text: "되돌아가요" }], 100)).toBe("30m 앞에서 되돌아가요");
    // 약 8 m 옆으로 비켜 갔다 오는 작은 꺾임
    const jog: [number, number][] = [[8.3, 47.0], [8.3, 47.0005], [8.30015, 47.0005], [8.30015, 47.00057], [8.30030, 47.00057], [8.30030, 47.0015]];
    const j = buildInstructions(jog, [], []).filter((i) => i.kind.startsWith("turn"));
    expect(j.length).toBeLessThanOrEqual(2);
  });
});
