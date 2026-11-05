import { el } from "./components";

export interface LoadingOverlay {
  el: HTMLElement;
  /** 불러오는 중 상태로 (다시) 보인다. */
  loading(): void;
  /** 실패 문구와 "다시 시도" 버튼을 보인다. */
  fail(message: string, onRetry: () => void): void;
  remove(): void;
}

/**
 * 지도 가운데 떠 있는 불러오기 알림: 문구 + 끝을 알 수 없는 진행 막대(움직임 줄이기면 멈춘 막대).
 * 실패하면 같은 자리에서 다시 시도할 수 있다.
 */
export function loadingOverlay(container: HTMLElement, label: string): LoadingOverlay {
  // 빈 알림 영역을 먼저 넣고 다음 프레임에 문구를 채워야 스크린 리더가 읽는다.
  const box = el("div", { class: "map-overlay", role: "status", "aria-live": "polite" });
  container.append(box);
  let gone = false;
  let frame = 0;

  const showLoading = (): void => {
    box.classList.remove("is-error");
    box.replaceChildren();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (gone) return;
      box.replaceChildren(
        el("span", { class: "map-overlay-text" }, label),
        el("span", { class: "progress", "aria-hidden": "true" }, el("span", { class: "progress-bar" })),
      );
    });
  };
  showLoading();

  return {
    el: box,
    loading: showLoading,
    fail(message, onRetry) {
      if (gone) return;
      cancelAnimationFrame(frame);
      box.classList.add("is-error");
      const retry = el("button", { type: "button", class: "btn" }, "다시 시도");
      retry.addEventListener("click", () => {
        onRetry();
        // 다시 시도 버튼이 사라지므로 포커스를 알림 상자로 옮긴다.
        box.setAttribute("tabindex", "-1");
        box.focus({ preventScroll: true });
      });
      box.replaceChildren(el("span", { class: "map-overlay-text" }, message), retry);
    },
    remove() {
      gone = true;
      cancelAnimationFrame(frame);
      box.remove();
    },
  };
}
