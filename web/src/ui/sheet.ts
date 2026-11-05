export type Snap = "peek" | "half" | "full";

export interface Sheet {
  el: HTMLElement;
  setContent(node: Node): void;
  setSnap(s: Snap): void;
  snap(): Snap;
}

const ORDER: Snap[] = ["peek", "half", "full"];
const WIDE = "(min-width: 1024px)";

function heightPx(s: Snap): number {
  const vh = window.innerHeight || 800;
  if (s === "peek") return 132;
  return s === "half" ? vh * 0.5 : vh * 0.88;
}

export function mountSheet(panel: HTMLElement): Sheet {
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
  panel.append(handle, content);

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

  let startY = 0;
  let startH = 0;
  let dragging = false;
  let dragged = false;

  handle.addEventListener("click", () => {
    if (dragged) return;
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

  // 드래그: 핸들을 따라 높이가 바뀌고, 놓으면 가장 가까운 높이로 맞춘다.
  handle.addEventListener("pointerdown", (e) => {
    if (wide) return;
    dragging = true;
    dragged = false;
    startY = e.clientY;
    startH = panel.getBoundingClientRect().height;
    handle.setPointerCapture?.(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 4) dragged = true;
    if (!dragged) return;
    panel.classList.add("dragging");
    const h = Math.max(heightPx("peek"), Math.min(heightPx("full"), startH + dy));
    panel.style.height = `${h}px`;
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture?.(e.pointerId);
    panel.classList.remove("dragging");
    if (dragged) {
      const h = panel.getBoundingClientRect().height || startH;
      let best: Snap = "peek";
      for (const s of ORDER) if (Math.abs(heightPx(s) - h) < Math.abs(heightPx(best) - h)) best = s;
      setSnap(best);
      setTimeout(() => {
        dragged = false;
      }, 0);
    }
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);

  sync();
  return {
    el: panel,
    setContent(node) {
      content.replaceChildren(node);
      content.scrollTop = 0;
    },
    setSnap,
    snap: () => current,
  };
}
