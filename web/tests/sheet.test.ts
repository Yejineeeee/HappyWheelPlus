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
});
