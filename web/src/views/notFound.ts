import { HOME_CRUMB } from "../ui/shell";
import { notFoundBlock } from "../ui/components";
import type { AppContext, View } from "./types";

export function notFoundView(): View {
  return {
    mount(ctx: AppContext) {
      ctx.shell.setTitle("찾을 수 없어요", [HOME_CRUMB]);
      ctx.sheet.setContent(notFoundBlock());
    },
    unmount() {},
  };
}
