import { describe, expect, it, vi } from "vitest";
import { kvList, scoreMeter, segmented } from "../src/ui/components";

describe("kvList", () => {
  it("renders label/value rows in a description list and marks the strong row", () => {
    const list = kvList([
      { label: "거리", value: "1.8km" },
      { label: "추가 거리", value: "+365m", strong: true },
    ]);
    expect(list.tagName).toBe("DL");
    const rows = [...list.querySelectorAll(".kv-row")];
    expect(rows.map((r) => [r.querySelector("dt")!.textContent, r.querySelector("dd")!.textContent])).toEqual([
      ["거리", "1.8km"],
      ["추가 거리", "+365m"],
    ]);
    expect(list.querySelectorAll(".is-strong").length).toBe(1);
  });
});

describe("scoreMeter", () => {
  it("shows the number and the word with a 0-100 bar", () => {
    const m = scoreMeter(86.4);
    expect(m.textContent).toBe("86좋음");
    expect(m.querySelector<HTMLElement>(".score-bar-fill")!.style.width).toBe("86.4%");
    expect(m.querySelector(".score-bar")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows a dash when there is no score", () => {
    expect(scoreMeter(null).textContent).toBe("–");
  });
});

describe("segmented", () => {
  const opts = [
    { value: "a", label: "최단" },
    { value: "b", label: "휠체어" },
    { value: "c", label: "내 조건" },
  ] as const;

  function setup() {
    const onChange = vi.fn();
    const s = segmented([...opts], "b", onChange, "경로 보기");
    document.body.replaceChildren(s.el);
    const radios = [...s.el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    return { s, onChange, radios };
  }

  const key = (target: HTMLElement, k: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

  it("is a labelled radio group with one checked, focusable option", () => {
    const { s, radios } = setup();
    expect(s.el.getAttribute("role")).toBe("radiogroup");
    expect(s.el.getAttribute("aria-label")).toBe("경로 보기");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("arrow keys move, select and focus with wrap-around", () => {
    const { s, onChange, radios } = setup();
    key(radios[1], "ArrowRight");
    expect(s.value()).toBe("c");
    expect(onChange).toHaveBeenLastCalledWith("c");
    expect(document.activeElement).toBe(radios[2]);
    key(radios[2], "ArrowRight");
    expect(s.value()).toBe("a");
    key(radios[0], "ArrowLeft");
    expect(s.value()).toBe("c");
    key(radios[2], "Home");
    expect(s.value()).toBe("a");
    key(radios[0], "End");
    expect(s.value()).toBe("c");
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("click selects; re-selecting or set() does not fire onChange", () => {
    const { s, onChange, radios } = setup();
    radios[0].click();
    expect(onChange).toHaveBeenCalledTimes(1);
    radios[0].click();
    expect(onChange).toHaveBeenCalledTimes(1);
    s.set("c");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
  });
});
