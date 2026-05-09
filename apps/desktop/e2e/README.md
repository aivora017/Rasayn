# pharmacare-pro Desktop — E2E (Playwright)

Pre-pilot smoke gate, S28-A2.

5 critical flows:

| # | spec | what it covers | runnable now |
|---|---|---|---|
| 1 | `login.spec.ts` | bootstrap -> dashboard render -> shop loaded | yes |
| 2 | `save_bill.spec.ts` | search product -> save bill -> IPC `save_bill` called | yes |
| 3 | `grn.spec.ts` | manual GRN line -> save -> IPC `grn_save` called (CSV path stubbed `test.skip`) | yes |
| 4 | `return.spec.ts` | partial-refund picker by bill id | yes |
| 5 | `gstr3b_export.spec.ts` | Reports -> click GSTR-3B -> IPC `generate_gstr3b_payload` called | yes |

Browser-mode against vite dev server is the **baseline**; tauri-driver
mode is a **post-pilot upgrade** (filed as TODO in each spec where the
Tauri-FS dialog is the only true coverage).

## Run sandbox-side (browser mode)

```bash
# from repo root
npm install
npx playwright install chromium
npm --workspace=@pharmacare/desktop run test:e2e
```

Or from `apps/desktop/`:

```bash
npm run test:e2e            # headless
npm run test:e2e:ui         # Playwright UI mode
```

The vite dev server starts automatically (`webServer` block in
`playwright.config.ts`). It listens on port 1420 (matches
`vite.config.ts` `strictPort: true`).

## Run Tauri-side (post-pilot, S30+)

The `test.skip(...)` blocks marked `TODO: Tauri-only` will be activated
once `tauri-driver` is wired up. Plan:

1. Add `@tauri-apps/cli` to devDeps (already present).
2. Add `tauri-driver` to the toolchain image.
3. Replace the `webServer` block with a `tauri build --debug` step + a
   `tauri-driver` launcher.
4. Unskip the CSV-import / file-save-dialog / login-form blocks.

## How the IPC stub works

`e2e/utils/ipc-stub.ts` installs a deterministic in-page invoke handler
via `page.addInitScript`. The handler is keyed on the same `cmd` string
the Rust commands respond to (see `apps/desktop/src/lib/ipc.ts`
`IpcCall` union for the full surface).

For each test you can override individual handlers:

```ts
await installIpcStub(page, {
  search_products: (args) => [/* custom hits */],
});
```

Calls are recorded in `window.__PHARMACARE_E2E_CALLS__`; the helper
`expectCmdCalled(page, "save_bill")` asserts a given cmd was reached.

## Adding a new flow

1. Add a `<flow>.spec.ts` here.
2. Reuse `installIpcStub(page)` in `beforeEach`.
3. Add new default handlers to `buildHandlerMap()` in `ipc-stub.ts` if
   the flow needs them.
4. Use `data-testid` selectors only — never CSS-class or structural.

## CI

Browser-mode E2E runs in the `e2e` job in `.github/workflows/e2e.yml`.
On a green run all 5 spec files execute; the `test.skip`'d Tauri-only
blocks are reported as skipped (not failed). Failure surface =
screenshot + trace artifact retained in the run.

## Known gaps (post-pilot)

- No real `/login` route exists yet; spec #1 covers bootstrap-only.
- CSV-import dialog (spec #3) needs tauri-driver.
- File-save dialog for GSTR-3B PDF (spec #5) needs tauri-driver.
- The picker selectors in `return.spec.ts` use `ret-mode-*` test IDs
  that may not all exist in the current build — the spec degrades to
  IPC-call assertion (`get_bill_full` / `get_refundable_qty`) so it
  still validates the flow reached the IPC layer.
