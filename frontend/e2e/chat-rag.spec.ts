import { test, expect, loginAsAdmin } from "./fixtures";

test("fast chat send shows progress or reply", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/");
  const input = page.locator("textarea").first();
  await input.fill("用一句话介绍遵义会议");
  await page.getByRole("button", { name: /发送/ }).click();
  await expect(page.getByText(/生成中|处理进度|遵义|会议/).first()).toBeVisible({
    timeout: 90_000,
  });
});
