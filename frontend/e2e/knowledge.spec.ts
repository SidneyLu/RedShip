import { test, expect, loginAsAdmin } from "./fixtures";

test("knowledge page shows overview", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { name: "知识库总览" })).toBeVisible();
  await expect(page.getByText("入库文档")).toBeVisible();
});
