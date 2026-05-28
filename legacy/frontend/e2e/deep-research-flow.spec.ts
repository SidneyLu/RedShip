import { expect, test } from '@playwright/test';

test('thread ask + deep research flow', async ({ page }) => {
  test.setTimeout(600_000);
  const email = process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_REGISTER_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_REGISTER_PASSWORD;
  if (!email || !password) {
    test.skip(true, 'Set E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD (or register vars) to run this flow.');
  }

  await page.goto('/profile');
  await page.getByPlaceholder('邮箱').fill(email!);
  await page.getByPlaceholder('密码').fill(password!);
  await page.getByRole('button', { name: '登录' }).click();

  await page.goto('/');
  await expect(page.getByText('RedShip Studio')).toBeVisible();
  await page.getByRole('button', { name: /新建研究/ }).click();

  await page.getByPlaceholder('输入研究任务、追问或追加说明...').fill('请给出一份关于党史研究方法论的证据化总结');
  await page.getByRole('button', { name: '普通追问' }).click();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('citations:', { exact: false })).toBeVisible({ timeout: 60000 });

  await page.getByPlaceholder('输入研究任务、追问或追加说明...').fill('请生成关于党史研究方法论的完整研究报告');
  await page.getByRole('button', { name: '研究指令' }).click();
  await page.getByRole('button', { name: '深度研究', exact: true }).click();
  await expect(page.getByText('研究计划')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: '确认计划' }).click();
  await expect(page.getByText('研究进度')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: /来源/ }).click();
  await expect(page.getByText('来源抽屉')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: '关闭来源抽屉' }).click();

  await page.getByRole('link', { name: /详情页/ }).click();
  await expect(page.getByText('深度研究详情')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('轮次：', { exact: false })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: '停止并收敛' })).toBeEnabled({ timeout: 180000 });
  await page.getByRole('button', { name: '停止并收敛' }).click();
  await expect(page.getByText('研究报告预览')).toBeVisible({ timeout: 180000 });

  await page.goto('/');
  await page.getByRole('link', { name: '账户' }).click();
  await expect(page.getByText('/profile')).toBeVisible({ timeout: 30000 });
  await page.goto('/');
  await page.getByRole('link', { name: '管理员控制台' }).click();
  await expect(page.getByText('管理员控制台')).toBeVisible({ timeout: 30000 });
});
