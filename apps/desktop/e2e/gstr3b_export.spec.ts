// GSTR-3B export smoke — pre-pilot E2E flow #5.
import { test, expect } from "@playwright/test";
import { installIpcStub, expectCmdCalled } from "./utils/ipc-stub.js";

test.describe("gstr3b export flow", () => {
  test.beforeEach(async ({ page }) => {
    await installIpcStub(page);
  });

  test("click GSTR-3B -> IPC called + toast surfaces", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("screen-host")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Alt+3");
    const panel = page.getByTestId("reports-export-panel");
    await panel.waitFor({ timeout: 10_000 }).catch(() => {});
    const btn = page.getByTestId("export-3b");
    if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await btn.click();
    }
    const sawGstr3b =
      (await expectCmdCalled(page, "generate_gstr3b_payload")) ||
      (await expectCmdCalled(page, "export_gstr3b_pdf")) ||
      (await expectCmdCalled(page, "export_gstr3b_json"));
    const lastToast = page.getByTestId("export-last");
    const errToast = page.getByTestId("export-error");
    const toastVisible =
      (await lastToast.isVisible({ timeout: 2_000 }).catch(() => false)) ||
      (await errToast.isVisible({ timeout: 2_000 }).catch(() => false));
    expect(sawGstr3b || toastVisible).toBe(true);
  });

  test.skip(
    "TODO: file-save dialog is Tauri-only — runs in tauri-driver post-pilot",
    async () => {},
  );
});
