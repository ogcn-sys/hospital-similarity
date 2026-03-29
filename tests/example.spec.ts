import { expect, test } from "@playwright/test";

test("example.com のタイトルを確認する", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Example Domain/);
});
