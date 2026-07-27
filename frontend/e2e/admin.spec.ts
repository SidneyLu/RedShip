import { test, expect, loginAsAdmin } from "./fixtures";

test("admin page shows sync and rebuild graph", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "管理控制台" })).toBeVisible();
  await expect(page.getByRole("button", { name: /增量同步|同步中/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "重建图谱" })).toBeVisible();
});
