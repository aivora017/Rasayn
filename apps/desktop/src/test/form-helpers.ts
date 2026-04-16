/**
 * Shared test helpers for controlled-input forms with disabled-until-dirty submit buttons.
 *
 * Promoted to a shared module per ADR 0008 follow-up commitment. See
 * docs/adr/0008-ci-settings-screen-flake-harden.md for the CI-load race
 * these helpers eliminate.
 *
 * Usage:
 *   import { retype, clickWhenEnabled } from "../test/form-helpers.js";
 *
 *   const user = userEvent.setup();
 *   await retype(user, input, "new value");
 *   await clickWhenEnabled(user, "save-btn");
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

type User = ReturnType<typeof userEvent.setup>;

/**
 * Clear an input, type the new value, and wait until React commits the
 * controlled-input state. Eliminates the CI-load race where userEvent.type
 * keystrokes land before the state machine sees them.
 *
 * Accepts HTMLElement (the return type of testing-library queries) and
 * casts internally — callers don't need to narrow.
 */
export async function retype(
  user: User,
  el: HTMLElement,
  value: string,
): Promise<void> {
  await user.clear(el);
  if (value.length > 0) await user.type(el, value);
  await waitFor(() => expect((el as HTMLInputElement).value).toBe(value));
}

/**
 * Wait for a button (resolved by data-testid) to become enabled, then click
 * it. Fails loudly with "button stayed disabled" instead of a silent no-op
 * if `dirty`-tracking hasn't propagated yet.
 */
export async function clickWhenEnabled(
  user: User,
  testId: string,
): Promise<void> {
  const btn = await screen.findByTestId(testId);
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  await user.click(btn);
}
