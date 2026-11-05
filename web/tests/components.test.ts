import { describe, expect, it, vi } from "vitest";
import { segmented, stat, stats } from "../src/ui/components";

describe("stat", () => {
  it("puts the label above the value inside a description list", () => {
    const list = stats([stat("거리", "1.8", { unit: "km", hint: "좋음" }), stat("코스", "15")]);
    expect(list.tagName).toBe("DL");
    const first = list.querySelector(".stat")!;
    const [dt, dd] = [first.children[0], first.children[1]];
    expect(dt.tagName).toBe("DT");
    expect(dt.textContent).toBe("거리");
    expect(dd.tagName).toBe("DD");
    expect(dd.textContent).toBe("1.8km");
    expect(first.querySelector(".stat-hint")?.textContent).toBe("좋음");
    expect(list.querySelectorAll(".stat").length).toBe(2);
  });

  it("marks the large variant", () => {
    expect(stat("점수", "87", { size: "lg" }).classList.contains("stat-lg")).toBe(true);
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
