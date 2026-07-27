import { test, expect, loginAsAdmin } from "./fixtures";

test("admin can login via LoginPanel", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByText("研究工作台").first()).toBeVisible();
});
