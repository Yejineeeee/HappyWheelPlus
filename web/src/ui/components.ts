import { scoreColor } from "../map/style";
import { scoreLabel } from "./format";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

export function metricTable(
  rows: { label: string; a: string; b?: string }[],
  headers: [string, string?],
  caption?: string,
): HTMLElement {
  const table = el("table", { class: "metric-table" });
  if (caption) table.append(el("caption", {}, caption));
  const hasB = headers[1] !== undefined;
  const headRow = el(
    "tr",
    {},
    el("th", { scope: "col" }, "항목"),
    el("th", { scope: "col", class: "num" }, headers[0]),
  );
  if (hasB) headRow.append(el("th", { scope: "col", class: "num" }, headers[1]!));
  table.append(el("thead", {}, headRow));
  const body = el("tbody");
  for (const r of rows) {
    const tr = el("tr", {}, el("th", { scope: "row" }, r.label), el("td", { class: "num" }, r.a));
    if (hasB) tr.append(el("td", { class: "num" }, r.b ?? "–"));
    body.append(tr);
  }
  table.append(body);
  return table;
}

export function badge(text: string, tone: "neutral" | "good" | "warn" | "field"): HTMLElement {
  return el("span", { class: `badge badge-${tone}` }, text);
}

export function loadingBlock(label: string): HTMLElement {
  return el(
    "div",
    { class: "block block-loading", role: "status", "aria-busy": "true" },
    el("span", { class: "spinner", "aria-hidden": "true" }),
    el("span", {}, label),
  );
}

export function errorBlock(message: string, onRetry: () => void): HTMLElement {
  const btn = el("button", { type: "button", class: "btn" }, "다시 시도");
  btn.addEventListener("click", onRetry);
  return el("div", { class: "block block-error", role: "alert" }, el("p", {}, message), btn);
}

export function notFoundBlock(): HTMLElement {
  return el(
    "div",
    { class: "block block-notfound" },
    el("h2", {}, "찾을 수 없어요"),
    el("p", {}, "주소가 바뀌었거나 없는 페이지예요."),
    el("a", { href: "#/", class: "btn" }, "처음으로"),
  );
}

export interface KvRow {
  label: string;
  value: string | Node;
  /** 화면에서 하나만 굵게 강조할 값. */
  strong?: boolean;
}

/** 2열 키-값 목록(dl): 왼쪽 라벨(회색), 오른쪽 값, 줄 사이 1px 구분선. */
export function kvList(rows: KvRow[], cls = ""): HTMLElement {
  const dl = el("dl", { class: cls ? `kv ${cls}` : "kv" });
  for (const r of rows) {
    dl.append(
      el(
        "div",
        { class: r.strong ? "kv-row is-strong" : "kv-row" },
        el("dt", {}, r.label),
        el("dd", {}, r.value),
      ),
    );
  }
  return dl;
}

/** 점수 표시: 점수 색 점 + 숫자 + 등급 말 + 0~100 가는 막대. */
export function scoreMeter(score: number | null): HTMLElement {
  const node = el("span", { class: "score-meter" });
  if (score === null) {
    node.append(el("span", { class: "score-meter-num" }, "–"));
    return node;
  }
  const v = Math.max(0, Math.min(100, score));
  const dot = el("span", { class: "score-dot", "aria-hidden": "true" });
  dot.style.background = scoreColor(v);
  const fill = el("span", { class: "score-bar-fill" });
  fill.style.width = `${v}%`;
  fill.style.background = scoreColor(v);
  node.append(
    el(
      "span",
      { class: "score-meter-line" },
      dot,
      el("span", { class: "score-meter-num" }, String(Math.round(score))),
      el("span", { class: "score-meter-label" }, scoreLabel(score)),
    ),
    el("span", { class: "score-bar", "aria-hidden": "true" }, fill),
  );
  return node;
}

export interface Segmented<T extends string> {
  el: HTMLElement;
  value(): T;
  /** 화면만 바꾼다(onChange를 부르지 않는다). */
  set(v: T): void;
}

/**
 * 알약형 세그먼트 탭(라디오 그룹). 화살표 키로 이동하면서 바로 선택하고, 선택된 항목만 Tab 순서에 들어간다.
 */
export function segmented<T extends string>(
  options: { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
  label = "보기 선택",
): Segmented<T> {
  const group = el("div", { class: "segmented", role: "radiogroup", "aria-label": label });
  let current = value;
  const buttons = options.map((o) => {
    const b = el("button", { type: "button", role: "radio", class: "segmented-option", "data-value": o.value }, o.label);
    b.addEventListener("click", () => choose(o.value, false));
    return b;
  });
  const sync = () => {
    buttons.forEach((b, i) => {
      const on = options[i].value === current;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };
  const choose = (v: T, focus: boolean) => {
    const changed = v !== current;
    current = v;
    sync();
    if (focus) buttons[options.findIndex((o) => o.value === v)]?.focus();
    if (changed) onChange(v);
  };
  group.addEventListener("keydown", (e) => {
    const i = options.findIndex((o) => o.value === current);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    choose(options[next].value, true);
  });
  group.append(...buttons);
  sync();
  return {
    el: group,
    value: () => current,
    set(v) {
      current = v;
      sync();
    },
  };
}
