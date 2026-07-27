import { test, expect, loginAsAdmin } from "./fixtures";

test("knowledge graph page loads", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/knowledge/graph");
  await expect(page.getByRole("heading", { name: "知识图谱" })).toBeVisible();
  await expect(page.getByRole("button", { name: "筛选" })).toBeVisible();
});
