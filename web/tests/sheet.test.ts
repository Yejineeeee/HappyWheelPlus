import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountSheet } from "../src/ui/sheet";

function key(target: Element, k: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

function stubWide(matches: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

describe("sheet", () => {
  let panel: HTMLElement;
  const orig = window.matchMedia;
  afterEach(() => {
    window.matchMedia = orig;
  });
  beforeEach(() => {
    stubWide(false);
    document.body.innerHTML = "";
    panel = document.createElement("section");
    document.body.append(panel);
  });

  it("has region semantics and starts at peek", () => {
    const s = mountSheet(panel);
    expect(s.el).toBe(panel);
    expect(s.el.getAttribute("role")).toBe("region");
    expect(s.el.getAttribute("aria-label")).toBe("정보 패널");
    expect(s.snap()).toBe("peek");
  });

  it("sheet keyboard toggles snap", () => {
    const s = mountSheet(panel);
    const handle = panel.querySelector<HTMLButtonElement>("button.sheet-handle")!;
    expect(handle.getAttribute("aria-label")).toBe("패널 크기 바꾸기");
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    key(handle, "ArrowUp");
    expect(s.snap()).toBe("half");
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    key(handle, "ArrowUp");
    expect(s.snap()).toBe("full");
    key(handle, "ArrowUp");
    expect(s.snap()).toBe("full");
    key(handle, "ArrowDown");
    expect(s.snap()).toBe("half");
    key(handle, "ArrowDown");
    key(handle, "ArrowDown");
    expect(s.snap()).toBe("peek");
    expect(handle.getAttribute("aria-expanded")).toBe("false");
  });

  it("click cycles peek, half, full, peek", () => {
    const s = mountSheet(panel);
    const handle = panel.querySelector<HTMLButtonElement>("button.sheet-handle")!;
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      handle.click();
      seen.push(s.snap());
    }
    expect(seen).toEqual(["half", "full", "peek"]);
  });

  it("setContent replaces the scrolling content", () => {
    const s = mountSheet(panel);
    const a = document.createElement("p");
    const b = document.createElement("p");
    s.setContent(a);
    s.setContent(b);
    const body = panel.querySelector(".sheet-content")!;
    expect(body.children.length).toBe(1);
    expect(body.firstElementChild).toBe(b);
  });

  it("is a static panel on wide screens", () => {
    stubWide(true);
    const s = mountSheet(panel);
    const handle = panel.querySelector<HTMLButtonElement>("button.sheet-handle")!;
    expect(handle.hidden).toBe(true);
    s.setSnap("full");
    expect(s.snap()).toBe("peek");
  });

  describe("dragging from the header", () => {
    function setup() {
      const head = document.createElement("div");
      head.innerHTML = '<nav class="crumbs"><a href="#/paris">파리</a></nav><h1>코스</h1>';
      const s = mountSheet(panel, head);
      // happy-dom은 배치를 하지 않으므로 높이는 style.height(없으면 접힌 높이)로 본다.
      panel.getBoundingClientRect = () =>
        ({ height: parseFloat(panel.style.height) || s.peekHeight() }) as DOMRect;
      Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
      return { s, head, link: head.querySelector("a")! };
    }
    const ptr = (target: Element, type: string, y: number) =>
      target.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientY: y, bubbles: true }));

    it("the title row is part of the drag area and snaps to the nearest height", () => {
      const { s, head } = setup();
      expect(head.classList.contains("sheet-drag-zone")).toBe(true);
      ptr(head, "pointerdown", 700);
      ptr(head, "pointermove", 600);
      ptr(head, "pointermove", 420); // 132 + 280 = 412px → 절반(400px)에 가깝다
      expect(panel.classList.contains("dragging")).toBe(true);
      ptr(head, "pointerup", 420);
      expect(panel.classList.contains("dragging")).toBe(false);
      expect(s.snap()).toBe("half");
    });

    it("a tap on a breadcrumb link still works, but the click after a drag is swallowed", () => {
      const { s, head, link } = setup();
      let clicks = 0;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        clicks++;
      });
      // 누르기: 문턱보다 적게 움직임
      ptr(link, "pointerdown", 700);
      ptr(link, "pointermove", 697);
      ptr(link, "pointerup", 697);
      link.click();
      expect(clicks).toBe(1);
      expect(s.snap()).toBe("peek");
      // 끌기 직후의 클릭은 링크로 가지 않는다
      ptr(link, "pointerdown", 700);
      ptr(link, "pointermove", 300);
      ptr(link, "pointerup", 300);
      link.click();
      expect(clicks).toBe(1);
      expect(s.snap()).not.toBe("peek");
      void head;
    });

    it("setPeek changes the collapsed height and null restores the default", () => {
      const s = mountSheet(panel);
      expect(s.peekHeight()).toBe(132);
      s.setPeek(220);
      expect(s.peekHeight()).toBe(220);
      expect(panel.style.getPropertyValue("--sheet-collapsed")).toBe("220px");
      s.setPeek(null);
      expect(s.peekHeight()).toBe(132);
      expect(panel.style.getPropertyValue("--sheet-collapsed")).toBe("");
    });
  });
});
