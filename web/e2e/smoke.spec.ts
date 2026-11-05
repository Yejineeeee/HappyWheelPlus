import { expect, test } from "@playwright/test";

// 지도 타일·글꼴 같은 바깥 서버 요청 실패는 오프라인 환경에서 나올 수 있어 무시한다.
const IGNORED = [/Failed to load resource/i, /openfreemap/i, /net::ERR_/i, /AJAXError/i, /WebGL|webgl/i];

test("홈에서 코스 비교, 내 조건, 도시 비교, 잘못된 주소까지", async ({ page }) => {
  const exceptions: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORED.some((re) => re.test(m.text()))) errors.push(m.text());
  });

  // 홈 → 파리
  await page.goto("/#/");
  await expect(page.getByRole("heading", { level: 1, name: "HappyWheel+" })).toBeAttached();
  await page.getByRole("button", { name: /파리/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "파리" })).toBeVisible();

  // 첫 코스 → 비교 표
  await page.locator(".course-card").first().click();
  const compareTable = page.getByRole("table", { name: "최단 경로와 휠체어 경로 비교" });
  await expect(compareTable).toBeVisible();

  // 내 조건: 경사 피하기를 최대로
  await page.getByRole("radio", { name: "내 조건" }).click();
  const status = page.locator(".cond-status");
  await expect(status).toHaveText(/기본 조건이에요/);
  const slope = page.getByLabel("경사 피하기");
  await expect(slope).toBeEnabled();
  await slope.fill("2");
  await expect(status).toHaveText("내 조건으로 경로를 다시 찾았어요");
  await expect(page.getByRole("table", { name: "기본 휠체어 경로와 내 조건 경로 비교" })).toBeVisible();
  await expect(compareTable).toBeHidden();
  await expect(page.locator(".cond-value").first()).toHaveText("아주 많이");

  // 브레드크럼으로 도시 화면 복귀
  await page.getByRole("navigation", { name: "현재 위치" }).getByRole("link", { name: "파리" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "파리" })).toBeVisible();

  // 헤더 → 도시 비교: 그래프 4개
  await page.getByRole("link", { name: "도시 비교" }).click();
  await expect(page.locator(".chart-block")).toHaveCount(4);
  for (const block of await page.locator(".chart-block").all()) await expect(block.locator("svg").first()).toBeAttached();

  // 분석 방법
  await page.getByRole("link", { name: "분석 방법" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // 없는 주소
  await page.goto("/#/nowhere");
  await expect(page.getByRole("heading", { level: 1, name: "찾을 수 없어요" })).toBeVisible();
  await expect(page.getByRole("link", { name: /홈/ }).first()).toBeVisible();

  expect(exceptions, "처리되지 않은 예외").toEqual([]);
  expect(errors, "콘솔 오류").toEqual([]);
});
