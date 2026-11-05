import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../src/prompt";

describe("SYSTEM_PROMPT", () => {
  it("괜찮다는 항목은 낮게, 힘든 항목은 높게, 언급 없으면 1", () => {
    expect(SYSTEM_PROMPT).toContain("괜찮아요");
    expect(SYSTEM_PROMPT).toContain("상관없어요");
    expect(SYSTEM_PROMPT).toContain("신경 안 써요");
    expect(SYSTEM_PROMPT).toContain("0에서 0.5");
    expect(SYSTEM_PROMPT).toContain("1.5에서 2");
    expect(SYSTEM_PROMPT).toContain("언급하지 않은 항목은 1로");
  });
  it("설명은 해요체, 100자, 사용자 문장 인용 금지", () => {
    expect(SYSTEM_PROMPT).toContain("해요체");
    expect(SYSTEM_PROMPT).toContain("합니다체");
    expect(SYSTEM_PROMPT).toContain("100자");
    expect(SYSTEM_PROMPT).toContain("사용자 문장을 그대로 옮기지 않는다");
  });
});
