import { test, expect } from "@playwright/test";

test.describe("類似病院ダッシュボード UI検証", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://127.0.0.1:8765/hospital-similarity.html");
    // JSONデータの読み込みを待つ
    await page.waitForSelector("#hospital-count", { timeout: 30000 });
    await expect(page.locator("#hospital-count")).not.toBeEmpty();
  });

  test("メタ情報が1カードにまとまって表示される", async ({ page }) => {
    const metaCard = page.locator(".meta-card-combined");
    await expect(metaCard).toBeVisible();
    await expect(page.locator("#source-label")).toHaveText("株式会社 日本経営 医療需給総覧 Ver 1.0");
    await expect(page.locator("#hospital-count")).toContainText("病院");
    await expect(page.locator("#generated-at")).not.toBeEmpty();
  });

  test("表示病院セクションにヘッダーがない", async ({ page }) => {
    // 「表示病院」というh2が存在しないことを確認
    const headers = page.locator("h2");
    const allTexts = await headers.allTextContents();
    expect(allTexts).not.toContain("表示病院");
  });

  test("都道府県で絞り込み → 病院選択 → 職員構成の順序確認", async ({ page }) => {
    // 鳥取県で絞り込み
    await page.selectOption("#prefecture-filter", "鳥取県");
    await page.waitForTimeout(500);

    // リストから最初の病院を選択
    const hospitalList = page.locator("#hospital-list");
    const options = hospitalList.locator("option");
    const count = await options.count();
    expect(count).toBeGreaterThan(0);

    // 最初のoptionを選択
    const firstValue = await options.first().getAttribute("value");
    if (firstValue) {
      await hospitalList.selectOption(firstValue);
      await page.waitForTimeout(2000);
    }

    // 職員構成セクションの行の順序を確認
    const staffSection = page.locator(".detail-card").filter({ hasText: "職員構成" });
    await expect(staffSection).toBeVisible();
    const rows = staffSection.locator(".tree-row .tree-label");
    const labels = await rows.allTextContents();

    // 全職員数が最初に来ること
    expect(labels[0]).toContain("全職員数");
    // 医師数が2番目
    expect(labels[1]).toContain("医師数");
    // 常勤医数が3番目
    expect(labels[2]).toContain("常勤医数");
    // 看護職員数が4番目
    expect(labels[3]).toContain("看護職員数");
    // PT・OT・STが5番目
    expect(labels[4]).toContain("PT・OT・ST");
    // 看護補助者が6番目
    expect(labels[5]).toContain("看護補助者");
    // 薬剤師が7番目
    expect(labels[6]).toContain("薬剤師");
  });

  test("100件以上で絞り込み結果メッセージが表示される", async ({ page }) => {
    // フィルターなしの状態(8000件以上)
    const hospitalList = page.locator("#hospital-list");
    await expect(hospitalList).toContainText("絞り込み結果が100件以上です");
  });

  test("類似病院カードが表示される", async ({ page }) => {
    await page.selectOption("#prefecture-filter", "鳥取県");
    await page.waitForTimeout(500);

    const hospitalList = page.locator("#hospital-list");
    const firstValue = await hospitalList.locator("option").first().getAttribute("value");
    if (firstValue) {
      await hospitalList.selectOption(firstValue);
      await page.waitForTimeout(3000);
    }

    // 類似病院TOP10セクション
    const cards = page.locator(".comparison-card");
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);

    // 近似している要素 と 差異が大きい要素 が表示される
    await expect(page.locator(".comparison-section-title").first()).toBeVisible();
  });

  test("比較サマリーテーブルが5項目を含む", async ({ page }) => {
    await page.selectOption("#prefecture-filter", "鳥取県");
    await page.waitForTimeout(500);

    const hospitalList = page.locator("#hospital-list");
    const firstValue = await hospitalList.locator("option").first().getAttribute("value");
    if (firstValue) {
      await hospitalList.selectOption(firstValue);
      await page.waitForTimeout(3000);
    }

    const table = page.locator(".summary-table");
    await expect(table).toBeVisible();

    const headerCells = table.locator("tbody th");
    const rowLabels = await headerCells.allTextContents();
    expect(rowLabels).toContain("都道府県 / 二次医療圏");
    expect(rowLabels).toContain("総病床数");
    expect(rowLabels).toContain("病院機能");
    expect(rowLabels).toContain("総職員数");
    expect(rowLabels).toContain("DPC有無");
  });

  test("スクリーンショット取得", async ({ page }) => {
    await page.selectOption("#prefecture-filter", "鳥取県");
    await page.waitForTimeout(500);

    const hospitalList = page.locator("#hospital-list");
    const firstValue = await hospitalList.locator("option").first().getAttribute("value");
    if (firstValue) {
      await hospitalList.selectOption(firstValue);
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: "test-results/dashboard-full.png", fullPage: true });
  });

  test("DPCフィルターで絞り込みができる", async ({ page }) => {
    // 鳥取県で絞り込み
    await page.selectOption("#prefecture-filter", "鳥取県");
    await page.waitForTimeout(500);

    // DPCフィルタなし時の件数を取得
    const statusText = await page.locator("#selector-status").textContent();
    const allCount = parseInt(statusText?.match(/(\d+)/)?.[1] ?? "0", 10);

    // DPCありで絞り込み
    await page.selectOption("#dpc-filter", "yes");
    await page.waitForTimeout(300);
    const dpcYesStatus = await page.locator("#selector-status").textContent();
    expect(dpcYesStatus).toContain("DPCあり");
    const dpcYesCount = parseInt(dpcYesStatus?.match(/(\d+)/)?.[1] ?? "0", 10);
    expect(dpcYesCount).toBeLessThan(allCount);
    expect(dpcYesCount).toBeGreaterThan(0);

    // DPCなしで絞り込み
    await page.selectOption("#dpc-filter", "no");
    await page.waitForTimeout(300);
    const dpcNoStatus = await page.locator("#selector-status").textContent();
    expect(dpcNoStatus).toContain("DPCなし");
    const dpcNoCount = parseInt(dpcNoStatus?.match(/(\d+)/)?.[1] ?? "0", 10);
    expect(dpcNoCount).toBeLessThan(allCount);

    // DPCあり + DPCなし = 全件
    expect(dpcYesCount + dpcNoCount).toBe(allCount);
  });
});
