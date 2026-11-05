import type { FeatureCollection, LineString } from "geojson";
import {
  cachedGraph,
  cachedSegProps,
  computeCustom,
  isDefault,
  setCurrentRoute,
  type Conditions,
  type CustomResult,
} from "../core/conditions";
import { AI_MAX_CHARS, aiEnabled, requestWeights, type AiError } from "../ai/client";
import { loadGraph, loadPois, loadSegments } from "../data/load";
import type { CityEntry, Course, PoiKind, RouteMetrics, SegmentProps, Weights } from "../data/types";
import { showRoutes, showSegments } from "../map/layers";
import { el, errorBlock } from "../ui/components";
import { fmtDelta, fmtM, fmtPct } from "../ui/format";
import type { ProfileRow } from "../ui/profileChart";
import type { AppContext } from "./types";

const POI_KINDS: PoiKind[] = ["toilet", "elevator", "bench", "fountain"];
const POI_LABEL: Record<PoiKind, string> = {
  toilet: "화장실",
  elevator: "엘리베이터",
  bench: "벤치",
  fountain: "음수대",
};
/** 받침 유무에 따른 주격 조사까지 붙인 형태 */
const POI_SUBJECT: Record<PoiKind, string> = {
  toilet: "화장실이",
  elevator: "엘리베이터가",
  bench: "벤치가",
  fountain: "음수대가",
};
const SLIDERS: { key: keyof Weights; label: string }[] = [
  { key: "slope", label: "경사" },
  { key: "surface", label: "노면" },
  { key: "kerb", label: "연석" },
  { key: "uncertainty", label: "불확실성" },
];
const DEBOUNCE_MS = 250;
const AI_ERROR_TEXT: Record<AiError, string> = {
  disabled: "지금은 AI를 쓸 수 없어요. 슬라이더로 직접 조절해 보세요.",
  network: "지금은 AI를 쓸 수 없어요. 슬라이더로 직접 조절해 보세요.",
  bad_response: "지금은 AI를 쓸 수 없어요. 슬라이더로 직접 조절해 보세요.",
  rate_limited: "오늘 사용 한도를 다 썼어요. 슬라이더로 직접 조절해 보세요.",
  too_long: "300자 이내로 적어 주세요.",
};
const AI_BUTTON = "AI로 조건 맞추기";

export function missingMessage(kind: PoiKind): string {
  return `경로 300m 안에 ${POI_SUBJECT[kind]} 없어요`;
}

function signed(n: number, unit: string, digits = 0): string {
  const f = Number(n.toFixed(digits));
  if (f > 0) return `+${f}${unit}`;
  if (f < 0) return `−${-f}${unit}`;
  return `0${unit}`;
}

interface DiffRow {
  label: string;
  get: (m: RouteMetrics) => number | null;
  fmt: (v: number) => string;
  delta: (d: number) => string;
}

const DIFF_ROWS: DiffRow[] = [
  { label: "거리", get: (m) => m.length_m, fmt: fmtM, delta: fmtDelta },
  { label: "통과 불가 계단", get: (m) => m.steps_count, fmt: (v) => `${v}개`, delta: (d) => signed(d, "개") },
  { label: "최대 경사", get: (m) => m.max_grade_pct, fmt: (v) => fmtPct(v), delta: (d) => signed(d, "%p", 1) },
  { label: "6% 이상 경사 구간", get: (m) => m.steep_m, fmt: fmtM, delta: fmtDelta },
  { label: "돌길 구간", get: (m) => m.cobble_m, fmt: fmtM, delta: fmtDelta },
  { label: "평균 점수", get: (m) => m.mean_score, fmt: (v) => `${Math.round(v)}점`, delta: (d) => signed(d, "점") },
  { label: "300m 안 화장실", get: (m) => m.toilets_300m, fmt: (v) => `${v}곳`, delta: (d) => signed(d, "곳") },
];

export function diffTable(base: RouteMetrics, mine: RouteMetrics): HTMLElement {
  const table = el("table", { class: "metric-table diff-table" });
  table.append(el("caption", {}, "기본 접근성 경로와 내 조건 경로 비교"));
  table.append(
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        el("th", { scope: "col" }, "항목"),
        el("th", { scope: "col", class: "num" }, "기본"),
        el("th", { scope: "col", class: "num" }, "내 조건"),
        el("th", { scope: "col", class: "num" }, "차이"),
      ),
    ),
  );
  const body = el("tbody");
  for (const row of DIFF_ROWS) {
    const a = row.get(base);
    const b = row.get(mine);
    body.append(
      el(
        "tr",
        {},
        el("th", { scope: "row" }, row.label),
        el("td", { class: "num" }, a === null ? "–" : row.fmt(a)),
        el("td", { class: "num" }, b === null ? "–" : row.fmt(b)),
        el("td", { class: "num" }, a === null || b === null ? "–" : row.delta(b - a)),
      ),
    );
  }
  table.append(body);
  return table;
}

export interface ConditionsPanel {
  el: HTMLElement;
  /** 지도·저장소를 기본 경로 상태로 되돌리고 타이머를 정리한다. */
  destroy(): void;
}

export interface PanelOpts {
  ctx: AppContext;
  city: CityEntry;
  course: Course;
  /** 패널을 여닫는 버튼. aria-expanded를 이 모듈이 관리한다. */
  button: HTMLButtonElement;
  /** 표시 중인 경로의 경사 단면이 바뀌면 불린다. */
  onProfile(rows: ProfileRow[]): void;
}

export function conditionsPanel(opts: PanelOpts): ConditionsPanel {
  const { ctx, city, course, button } = opts;
  const defaults = ctx.index.weights_default;
  const baseAcc = course.routes.accessible;
  const defaultRoute = (): { coords: [number, number][]; segIds: number[] } => ({
    coords: baseAcc?.coords ?? course.routes.shortest.coords,
    segIds: baseAcc?.seg_ids ?? course.routes.shortest.seg_ids,
  });

  const cond: Conditions = { weights: { ...defaults }, requiredPois: [] };
  let compute: Parameters<typeof computeCustom>[0] | null = null;
  let segFc: FeatureCollection<LineString, SegmentProps> | null = null;
  let loading = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let appliedCustom = false;
  let dead = false;

  const root = el("section", { class: "conditions", id: `cond-${city.id}-${course.index}`, "aria-label": "내 조건", hidden: "" });
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", root.id);

  const status = el("div", { class: "cond-status", role: "status", "aria-live": "polite" });
  const result = el("div", { class: "cond-result" });
  const warnings = el("div", { class: "cond-warnings", role: "status", "aria-live": "polite" });

  // ----- 슬라이더 -----
  const inputs = new Map<keyof Weights, HTMLInputElement>();
  const outputs = new Map<keyof Weights, HTMLElement>();
  const sliderBox = el("div", { class: "cond-sliders" });
  const syncSlider = (key: keyof Weights): void => {
    const input = inputs.get(key)!;
    const label = SLIDERS.find((s) => s.key === key)!.label;
    const v = cond.weights[key];
    input.value = String(v);
    input.setAttribute("aria-valuetext", `${label} 중요도 ${v.toFixed(1)}`);
    outputs.get(key)!.textContent = v.toFixed(1);
  };
  for (const s of SLIDERS) {
    const id = `cond-${s.key}-${course.index}`;
    const input = el("input", { type: "range", id, min: "0", max: "2", step: "0.1" });
    const out = el("output", { class: "cond-value", for: id });
    inputs.set(s.key, input);
    outputs.set(s.key, out);
    input.addEventListener("input", () => {
      cond.weights[s.key] = Math.round(Number(input.value) * 10) / 10;
      syncSlider(s.key);
      schedule();
    });
    sliderBox.append(
      el("div", { class: "cond-row" }, el("label", { for: id }, `${s.label} 중요도`), out, input),
    );
    syncSlider(s.key);
  }

  // ----- 필수 편의시설 -----
  const checks = new Map<PoiKind, HTMLInputElement>();
  const fieldset = el("fieldset", { class: "cond-pois" }, el("legend", {}, "꼭 필요한 편의시설"));
  for (const k of POI_KINDS) {
    const id = `cond-poi-${k}-${course.index}`;
    const box = el("input", { type: "checkbox", id });
    checks.set(k, box);
    box.addEventListener("change", () => {
      cond.requiredPois = POI_KINDS.filter((x) => checks.get(x)!.checked);
      schedule();
    });
    fieldset.append(el("label", { class: "cond-check", for: id }, box, el("span", {}, POI_LABEL[k])));
  }

  const reset = el("button", { type: "button", class: "btn btn-quiet" }, "기본값으로");
  reset.addEventListener("click", () => {
    cond.weights = { ...defaults };
    cond.requiredPois = [];
    for (const s of SLIDERS) syncSlider(s.key);
    for (const box of checks.values()) box.checked = false;
    if (timer) clearTimeout(timer);
    timer = null;
    recompute();
  });

  // ----- 문장으로 조건 입력 -----
  let aiCtl: AbortController | null = null;
  let aiBox: HTMLElement | null = null;
  if (aiEnabled()) {
    const taId = `cond-ai-text-${course.index}`;
    const ta = el("textarea", { id: taId, class: "cond-ai-text", rows: "3", maxlength: String(AI_MAX_CHARS) });
    const count = el("span", { class: "cond-ai-count", "aria-live": "off" }, `0/${AI_MAX_CHARS}`);
    const aiBtn = el("button", { type: "button", class: "btn" }, AI_BUTTON);
    const aiResult = el("p", { class: "cond-ai-result", role: "status", "aria-live": "polite" });
    aiBtn.disabled = true;
    const busy = (): boolean => aiCtl !== null;
    const syncAi = (): void => {
      count.textContent = `${ta.value.length}/${AI_MAX_CHARS}`;
      aiBtn.disabled = busy() || ta.value.trim() === "";
    };
    ta.addEventListener("input", () => {
      syncAi();
      aiResult.textContent = ta.value.length >= AI_MAX_CHARS ? `${AI_MAX_CHARS}자까지 쓸 수 있어요.` : "";
    });
    aiBtn.addEventListener("click", () => {
      const text = ta.value.trim();
      if (!text) return;
      aiCtl?.abort();
      const mine = new AbortController();
      aiCtl = mine;
      aiBtn.textContent = "해석 중…";
      aiBtn.disabled = true;
      aiResult.textContent = "";
      void requestWeights({ city: city.id, text }, mine.signal).then((r) => {
        if (dead || aiCtl !== mine) return;
        aiCtl = null;
        aiBtn.textContent = AI_BUTTON;
        syncAi();
        if (!r.ok) {
          aiResult.textContent = AI_ERROR_TEXT[r.error];
          return;
        }
        cond.weights = { ...r.value.weights };
        cond.requiredPois = POI_KINDS.filter((k) => r.value.required_pois.includes(k));
        for (const sl of SLIDERS) syncSlider(sl.key);
        for (const k of POI_KINDS) checks.get(k)!.checked = cond.requiredPois.includes(k);
        aiResult.textContent = r.value.explanation ? `AI 해석: ${r.value.explanation}` : "AI 해석을 적용했어요";
        schedule();
      });
    });
    aiBox = el(
      "div",
      { class: "cond-ai" },
      el("label", { for: taId }, "문장으로 조건 입력"),
      ta,
      el("div", { class: "cond-ai-foot" }, count, aiBtn),
      aiResult,
    );
  }

  root.append(
    ...(aiBox ? [aiBox] : []),
    el("p", { class: "cond-hint" }, "값이 클수록 그 요소를 더 피하는 길을 찾아요. 0은 무시, 2는 아주 중요해요."),
    sliderBox,
    fieldset,
    el("div", { class: "cond-actions" }, reset),
    status,
    warnings,
    result,
  );

  // ----- 계산과 표시 -----
  function setStatus(text: string): void {
    status.replaceChildren(text);
  }

  function showDefault(): void {
    const r = defaultRoute();
    showRoutes(ctx.map, course.routes.shortest.coords, baseAcc?.coords ?? null);
    if (appliedCustom && segFc) showSegments(ctx.map, segFc, null);
    appliedCustom = false;
    setCurrentRoute(city.id, course.index, { ...r, source: "default" });
    opts.onProfile((baseAcc ?? course.routes.shortest).profile);
    result.replaceChildren();
    warnings.replaceChildren();
  }

  function apply(res: CustomResult): void {
    warnings.replaceChildren(
      ...res.missingPois.map((k) => el("p", { class: "notice notice-warn", role: "note" }, missingMessage(k))),
    );
    if (!res.path.reachable) {
      showDefault();
      warnings.append(el("p", { class: "notice notice-warn", role: "note" }, "이 조건으로는 이어지는 길을 찾지 못했어요"));
      return;
    }
    appliedCustom = true;
    showRoutes(ctx.map, course.routes.shortest.coords, res.coords, { baseline: baseAcc?.coords ?? null });
    if (segFc) showSegments(ctx.map, segFc, res.segScores);
    setCurrentRoute(city.id, course.index, { coords: res.coords, segIds: res.path.edges, source: "custom" });
    opts.onProfile(res.profile);
    result.replaceChildren();
    if (baseAcc) {
      result.append(
        diffTable(baseAcc.metrics, res.metrics),
        el("p", { class: "cond-note" }, "평균 점수는 각 경로를 그 조건의 가중치로 계산한 값이에요."),
      );
    }
  }

  function recompute(): void {
    if (dead || !compute) return;
    if (isDefault(cond, defaults)) {
      showDefault();
      setStatus("기본 조건이에요");
      return;
    }
    const res = computeCustom(compute, course, cond);
    apply(res);
    setStatus(res.path.reachable ? "내 조건으로 경로를 다시 찾았어요" : "");
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      recompute();
    }, DEBOUNCE_MS);
  }

  function setControlsDisabled(disabled: boolean): void {
    for (const i of inputs.values()) i.disabled = disabled;
    for (const c of checks.values()) c.disabled = disabled;
    (reset as HTMLButtonElement).disabled = disabled;
  }

  function load(): void {
    if (loading || compute) return;
    loading = true;
    setControlsDisabled(true);
    result.replaceChildren();
    setStatus("경로 계산에 필요한 데이터를 불러오는 중");
    Promise.all([loadGraph(city), loadSegments(city), loadPois(city)]).then(
      ([gj, fc, pois]) => {
        loading = false;
        if (ctx.signal.aborted || dead) return;
        segFc = fc;
        compute = {
          graph: cachedGraph(city.id, city.data_version, gj),
          segs: cachedSegProps(city.id, city.data_version, fc.features),
          segCoords: (id) => fc.features[id].geometry.coordinates as [number, number][],
          pois: pois.features.map((f) => ({
            kind: f.properties.kind,
            lon: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          })),
          alpha: ctx.index.alpha,
        };
        setControlsDisabled(false);
        setStatus("");
        // 열기 전에 조정한 값이 있으면 바로 반영한다.
        recompute();
      },
      () => {
        loading = false;
        if (ctx.signal.aborted || dead) return;
        status.replaceChildren(errorBlock("경로 계산 데이터를 불러오지 못했어요.", load));
      },
    );
  }

  button.addEventListener("click", () => {
    const open = root.hasAttribute("hidden");
    if (open) {
      root.removeAttribute("hidden");
      load();
    } else {
      root.setAttribute("hidden", "");
    }
    button.setAttribute("aria-expanded", String(open));
  });

  return {
    el: root,
    destroy() {
      dead = true;
      aiCtl?.abort();
      aiCtl = null;
      if (timer) clearTimeout(timer);
      timer = null;
      // 내 조건 점수로 칠한 히트맵이 남지 않게, 적용했던 경우에만 내보낸 점수로 되돌린다.
      if (appliedCustom && segFc) showSegments(ctx.map, segFc, null);
      appliedCustom = false;
    },
  };
}
