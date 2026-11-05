/** 휠체어로 이어지는 길이 없는 코스는 길안내를 하지 않는다. 코스 화면과 길안내 화면이 같은 문구를 쓴다. */
export const NO_NAV_TEXT = "휠체어로 이어지는 길이 없어 길안내를 할 수 없어요";

export function canGuide(c: { reachable: boolean; routes: { accessible: unknown } }): boolean {
  return c.reachable && c.routes.accessible !== null && c.routes.accessible !== undefined;
}
