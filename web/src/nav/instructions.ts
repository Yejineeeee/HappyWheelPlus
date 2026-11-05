import type { SegmentProps } from "../data/types";
import { bearing, cumulative, pointAt } from "./progress";

type LngLat = [number, number];

export interface Instruction {
  atM: number;
  text: string;
  kind: "turn-left" | "turn-right" | "slope" | "cobble" | "kerb" | "bridge" | "stop" | "arrive";
}

const TURN_DEG = 30;
const WINDOW_M = 20;
const STEP_M = 5;
const TURN_GAP_M = 25;
const MERGE_M = 15;
const STEEP_GRADE = 6;
const PRIORITY: Instruction["kind"][] = ["turn-left", "turn-right", "slope", "cobble", "kerb", "bridge", "stop", "arrive"];

function norm180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

function detectTurns(coords: LngLat[]): Instruction[] {
  if (coords.length < 3) return [];
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  if (total < 2 * WINDOW_M) return [];
  const samples: { d: number; delta: number }[] = [];
  for (let d = WINDOW_M; d <= total - WINDOW_M + 1e-6; d += STEP_M) {
    const before = pointAt(coords, cum, d - WINDOW_M);
    const here = pointAt(coords, cum, d);
    const after = pointAt(coords, cum, d + WINDOW_M);
    samples.push({ d, delta: norm180(bearing(here, after) - bearing(before, here)) });
  }
  // 기준을 넘는 연속 구간마다 변화가 가장 큰 지점을 꼭짓점으로 본다.
  const turns: { d: number; delta: number }[] = [];
  let i = 0;
  while (i < samples.length) {
    if (Math.abs(samples[i].delta) < TURN_DEG) {
      i++;
      continue;
    }
    let best = samples[i];
    let j = i;
    while (
      j < samples.length &&
      Math.abs(samples[j].delta) >= TURN_DEG &&
      Math.sign(samples[j].delta) === Math.sign(samples[i].delta)
    ) {
      if (Math.abs(samples[j].delta) > Math.abs(best.delta)) best = samples[j];
      j++;
    }
    turns.push(best);
    i = Math.max(j, i + 1);
  }
  const out: Instruction[] = [];
  let lastD = -Infinity;
  for (const t of turns) {
    if (t.d - lastD < TURN_GAP_M) continue;
    lastD = t.d;
    out.push(
      t.delta < 0 ? { atM: t.d, kind: "turn-left", text: "왼쪽" } : { atM: t.d, kind: "turn-right", text: "오른쪽" },
    );
  }
  return out;
}

export function buildInstructions(
  coords: LngLat[],
  segs: { segId: number; startM: number; endM: number; props: SegmentProps }[],
  stops: { name: string; atM: number }[],
): Instruction[] {
  const items: Instruction[] = detectTurns(coords);
  const cum = cumulative(coords);
  const total = cum.length > 0 ? cum[cum.length - 1] : 0;

  let prev: SegmentProps | null = null;
  for (const s of segs) {
    const p = s.props;
    const steep = (p.grade_max ?? 0) >= STEEP_GRADE;
    if (steep && !((prev?.grade_max ?? 0) >= STEEP_GRADE)) {
      items.push({ atM: s.startM, kind: "slope", text: `경사 ${Math.round(p.grade_max ?? 0)}% 구간 시작` });
    }
    if (p.surface_class === "cobble" && prev?.surface_class !== "cobble") {
      items.push({ atM: s.startM, kind: "cobble", text: "돌길 구간 시작" });
    }
    if (p.p_kerb > 0 && !((prev?.p_kerb ?? 0) > 0)) {
      items.push({ atM: s.startM, kind: "kerb", text: "높은 연석 주의" });
    }
    if (p.span && !prev?.span) {
      items.push({ atM: s.startM, kind: "bridge", text: "다리 구간" });
    }
    prev = p;
  }

  stops.forEach((st, i) => {
    if (i === 0) return; // 출발지는 안내하지 않는다
    if (i === stops.length - 1) items.push({ atM: st.atM, kind: "arrive", text: `목적지 ${st.name} 도착` });
    else items.push({ atM: st.atM, kind: "stop", text: `${st.name} 도착` });
  });
  if (stops.length < 2) {
    items.push({ atM: total, kind: "arrive", text: stops[0] ? `목적지 ${stops[0].name} 도착` : "목적지 도착" });
  }

  items.sort((a, b) => a.atM - b.atM || PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));

  // 앞 항목에서 15m 안이면 한 줄로 합친다. 회전이 있으면 회전이 먼저 오도록 정렬한다.
  const merged: Instruction[] = [];
  let group: Instruction[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    group.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
    merged.push({ atM: group[0].atM, kind: group[0].kind, text: group.map((g) => g.text).join(", ") });
    group = [];
  };
  for (const it of items) {
    if (group.length > 0 && it.atM - group[0].atM > MERGE_M) flush();
    group.push(it);
  }
  flush();
  // 도착 안내는 항상 맨 뒤
  const arriveIdx = merged.findIndex((m) => m.kind === "arrive");
  if (arriveIdx >= 0 && arriveIdx !== merged.length - 1) merged.push(...merged.splice(arriveIdx, 1));
  return merged;
}

const PASSED_M = 3;

export function nextInstructionText(ins: Instruction[], alongM: number): string {
  const next = ins.find((i) => i.atM > alongM - PASSED_M);
  if (!next) return "목적지에 도착했어요";
  if (next.kind !== "turn-left" && next.kind !== "turn-right") return next.text;
  const d = next.atM - alongM;
  if (d < 20) return `곧 ${next.text}`;
  return `${Math.round(d / 10) * 10}m 앞 ${next.text}`;
}
