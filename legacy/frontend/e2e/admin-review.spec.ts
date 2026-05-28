import { expect, test } from '@playwright/test';

test('admin console review flow', async ({ page }) => {
  const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.E2E_ADMIN_PASSWORD ?? 'AdminPass123!';

  await page.goto('/profile');
  await page.getByPlaceholder('邮箱').fill(email);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();

  await page.goto('/');
  await page.getByRole('link', { name: '管理员控制台' }).click();
  await expect(page.getByText('管理员控制台')).toBeVisible();

  // If queue is empty we just validate the page can load filters and actions.
  if (await page.getByText('暂无变更请求').isVisible().catch(() => false)) {
    await expect(page.getByText('文档管理')).toBeVisible();
    return;
  }

  const approveButton = page.getByRole('button', { name: '通过' }).first();
  if (await approveButton.isVisible().catch(() => false)) {
    await approveButton.click();
  }
});
