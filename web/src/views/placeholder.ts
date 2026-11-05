import { el } from "../ui/components";
import type { AppContext, View } from "./types";

/** 아직 만들지 않은 화면 자리. 이후 작업에서 실제 화면으로 바뀐다. */
export function placeholderView(title: string): View {
  return {
    mount(ctx: AppContext) {
      ctx.shell.setTitle(title, "#/");
      ctx.sheet.setContent(el("div", { class: "block" }, el("h2", {}, title), el("p", {}, "준비 중")));
    },
    unmount() {},
  };
}
