import { test as base, expect } from "@playwright/test";
import fs from "fs";
import net from "net";
import path from "path";

/** Load simple KEY=VALUE pairs from repo-root .env into process.env (no override). */
function loadRootEnv() {
  const envPath = path.resolve(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]) process.env[key] = val;
  }
}

loadRootEnv();

async function isUp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export const test = base.extend({});
test.beforeEach(async () => {
  const ok = await isUp("127.0.0.1", 8006);
  test.skip(!ok, "Frontend Compose not reachable on :8006");
});

export { expect };

export const adminEmail =
  process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_BOOTSTRAP_EMAIL || "admin@redship.local";
export const adminPassword =
  process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_BOOTSTRAP_PASSWORD || "";

/** Shared login helper used by e2e specs. */
export async function loginAsAdmin(page: import("@playwright/test").Page) {
  test.skip(!adminPassword, "E2E_ADMIN_PASSWORD not set");
  await page.goto("/");
  await page.getByPlaceholder("you@nankai.edu.cn").fill(adminEmail);
  await page.locator('input[type="password"]').fill(adminPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText("研究工作台").first()).toBeVisible({ timeout: 30_000 });
}
