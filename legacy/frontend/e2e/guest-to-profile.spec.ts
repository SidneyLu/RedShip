import { expect, test } from '@playwright/test';

test('guest register -> login -> profile -> upload -> submit review', async ({ page }) => {
  const email = process.env.E2E_REGISTER_EMAIL;
  const password = process.env.E2E_REGISTER_PASSWORD;
  const code = process.env.E2E_REGISTER_CODE;
  if (!email || !password || !code) {
    test.skip(true, 'Set E2E_REGISTER_EMAIL/E2E_REGISTER_PASSWORD/E2E_REGISTER_CODE to run this flow.');
  }

  await page.goto('/profile');
  await page.getByPlaceholder('邮箱').fill(email!);
  await page.getByPlaceholder('密码').fill(password!);
  await page.getByRole('button', { name: '注册' }).click();
  await page.getByPlaceholder('验证码（注册时填写）').fill(code!);
  await page.getByRole('button', { name: '注册' }).click();

  await expect(page.getByText('/profile')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '上传文档' }).click();
  const fileChooser = await chooser;
  await fileChooser.setFiles({
    name: 'e2e.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('e2e upload content'),
  });

  await expect(page.getByText('e2e.txt')).toBeVisible();
  await page.getByRole('button', { name: '提交审核' }).first().click();
  await expect(page.getByText('状态：pending_review')).toBeVisible();
});
