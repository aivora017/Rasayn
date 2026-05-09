// Login smoke — pre-pilot E2E flow #1.
//
// CURRENT STATE: pharmacare-pro has no /login route in the desktop app
// (auth is via the cashier-PIN on cash-shift open and the OS-user RBAC
// model — see RBACScreen.tsx). The "login" flow we exercise here is
// therefore the bootstrap -> dashboard render -> shop loaded -> AppShell
// nav rendered sequence.
//
// POST-PILOT TODO: when a /login route lands (S30+ password manager
// login flow per FORWARD_PLAN_v5), unskip the password block below.

import { test, expect } from "@playwright/test";
import { installIpcStub } from "./utils/ipc-stub.js";

test.describe("login + bootstrap smoke", () => {
  test.beforeEach(async ({ page }) => {
    await installIpcStub(page);
  });

  test("app boots, dashboard renders, shop loaded", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("screen-host")).toBeVisible({ timeout: 15_000 });
    const summary = page.getByTestId("shop-summary");
    await expect(summary).toBeVisible();
    await expect(page.getByTestId("current-mode")).toHaveText(/dashboard|billing/);
  });

  test.skip(
    "TODO: real /login form when password-auth lands (post-pilot S30+)",
    async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Username").fill("e2e");
      await page.getByLabel("Password").fill("e2e");
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page.getByTestId("screen-host")).toBeVisible();
    },
  );
});
