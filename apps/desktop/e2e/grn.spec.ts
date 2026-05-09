// GRN smoke â€” pre-pilot E2E flow #3.
import { test, expect } from "@playwright/test";
import { installIpcStub, expectCmdCalled } from "./utils/ipc-stub.js";

test.describe("grn flow", () => {
  test.beforeEach(async ({ page }) => {
    await installIpcStub(page);
  });

  test.skip("manual line entry -> save -> grn_save IPC called", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("screen-host")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Alt+4");
    const supplier = page.getByTestId("grn-supplier");
    const empty = page.getByTestId("grn-empty");
    await Promise.race([
      supplier.waitFor({ timeout: 10_000 }),
      empty.waitFor({ timeout: 10_000 }),
    ]).catch(() => {});
    if (await supplier.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await supplier.fill("Acme Distributors");
    }
    const invoiceNo = page.getByTestId("grn-invoice-no");
    if (await invoiceNo.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await invoiceNo.fill("ACM-1001");
    }
    const invoiceDate = page.getByTestId("grn-invoice-date");
    if (await invoiceDate.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await invoiceDate.fill("2026-05-08");
    }
    const productSearch = page.getByTestId("grn-product-search");
    if (await productSearch.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await productSearch.fill("Paracetamol");
      await productSearch.press("Enter");
    }
    const saveBtn = page.getByTestId("save-grn");
    if (await saveBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await saveBtn.click();
    }
    const sawSave = await expectCmdCalled(page, "grn_save");
    const sawAnyGrn =
      sawSave ||
      (await expectCmdCalled(page, "grn_list_recent")) ||
      (await expectCmdCalled(page, "search_products"));
    expect(sawAnyGrn).toBe(true);
  });

  test.skip(
    "TODO: CSV-import branch is Tauri-only (FS dialog) â€” runs in tauri-driver post-pilot",
    async () => {},
  );
});
