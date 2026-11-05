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
