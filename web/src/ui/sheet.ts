export type Snap = "peek" | "half" | "full";

export interface Sheet {
  el: HTMLElement;
  setContent(node: Node): void;
  setSnap(s: Snap): void;
  snap(): Snap;
  /** 접힌 높이(px)를 화면마다 바꾼다. null이면 기본값(132px). */
  setPeek(px: number | null): void;
  /** 지금 접힌 높이(px). */
  peekHeight(): number;
}

export const DEFAULT_PEEK = 132;
/** 이만큼 움직여야 끌기로 본다. 그보다 작으면 누르기(링크·버튼 클릭)로 둔다. */
const DRAG_THRESHOLD = 6;

const ORDER: Snap[] = ["peek", "half", "full"];
const WIDE = "(min-width: 1024px)";

function heightPx(s: Snap, peek: number): number {
  const vh = window.innerHeight || 800;
  if (s === "peek") return peek;
  return s === "half" ? Math.max(peek, vh * 0.5) : vh * 0.88;
}

/** head가 있으면 손잡이와 본문 사이에 둔다(스크롤되지 않는 제목 영역). */
export function mountSheet(panel: HTMLElement, head?: HTMLElement): Sheet {
  panel.classList.add("sheet");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "정보 패널");
  panel.replaceChildren();

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "sheet-handle";
  handle.setAttribute("aria-label", "패널 크기 바꾸기");
  const grip = document.createElement("span");
  grip.className = "sheet-grip";
  grip.setAttribute("aria-hidden", "true");
  handle.append(grip);

  const content = document.createElement("div");
  content.className = "sheet-content";
  if (head) panel.append(handle, head, content);
  else panel.append(handle, content);

  const mq = window.matchMedia?.(WIDE);
  let wide = mq?.matches ?? false;
  let current: Snap = "peek";

  const sync = () => {
    panel.dataset.snap = current;
    panel.dataset.wide = wide ? "true" : "false";
    handle.hidden = wide;
    handle.setAttribute("aria-expanded", String(current !== "peek"));
  };
  const setSnap = (s: Snap) => {
    if (wide) return;
    current = s;
    panel.style.height = "";
    sync();
  };
  const cycle = () => setSnap(ORDER[(ORDER.indexOf(current) + 1) % 3]);
  const step = (d: number) => setSnap(ORDER[Math.min(2, Math.max(0, ORDER.indexOf(current) + d))]);

  mq?.addEventListener?.("change", (e) => {
    wide = e.matches;
    panel.style.height = "";
    sync();
  });

  let peek = DEFAULT_PEEK;

  handle.addEventListener("click", () => {
    if (suppressClick) return;
    cycle();
  });
  handle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cycle();
    }
  });

  // 끌기: 손잡이와 제목 영역 어디서든 시작한다. 조금 움직이기 전까지는 누르기로 두어 경로 표시 링크가 그대로 눌린다.
  // 끌면 높이가 손가락을 따라가고, 놓으면 가장 가까운 높이로 맞춘다.
  let startY = 0;
  let startH = 0;
  let pointerId: number | null = null;
  let source: HTMLElement | null = null;
  let dragged = false;
  let suppressClick = false;

  const onDown = (zone: HTMLElement) => (e: PointerEvent) => {
    if (wide || (e.button !== undefined && e.button > 0)) return;
    pointerId = e.pointerId;
    source = zone;
    dragged = false;
    startY = e.clientY;
    startH = panel.getBoundingClientRect().height;
  };
  const onMove = (e: PointerEvent) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const dy = startY - e.clientY;
    if (!dragged) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      dragged = true;
      source?.setPointerCapture?.(e.pointerId);
      panel.classList.add("dragging");
    }
    const h = Math.max(heightPx("peek", peek), Math.min(heightPx("full", peek), startH + dy));
    panel.style.height = `${h}px`;
  };
  const end = (e: PointerEvent) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    pointerId = null;
    source?.releasePointerCapture?.(e.pointerId);
    source = null;
    panel.classList.remove("dragging");
    if (!dragged) return;
    dragged = false;
    const h = panel.getBoundingClientRect().height || startH;
    let best: Snap = "peek";
    for (const s of ORDER) if (Math.abs(heightPx(s, peek) - h) < Math.abs(heightPx(best, peek) - h)) best = s;
    setSnap(best);
    // 끌고 난 뒤 따라오는 클릭(링크 이동, 손잡이 전환)은 무시한다.
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  };
  const zones = head ? [handle, head] : [handle];
  for (const z of zones) {
    z.addEventListener("pointerdown", onDown(z));
    z.addEventListener("pointermove", onMove);
    z.addEventListener("pointerup", end);
    z.addEventListener("pointercancel", end);
  }
  head?.classList.add("sheet-drag-zone");
  head?.addEventListener(
    "click",
    (e) => {
      if (!suppressClick) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  sync();
  return {
    el: panel,
    setContent(node) {
      content.replaceChildren(node);
      content.scrollTop = 0;
    },
    setSnap,
    snap: () => current,
    setPeek(px) {
      peek = px ?? DEFAULT_PEEK;
      if (px === null) panel.style.removeProperty("--sheet-collapsed");
      else panel.style.setProperty("--sheet-collapsed", `${px}px`);
    },
    peekHeight: () => peek,
  };
}
