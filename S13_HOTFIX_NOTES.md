# S13 Hotfix — Windows-run breakages addressed

After the first Windows test run on 2026-04-29, ten distinct breakages
surfaced. All ten are now fixed on disk. **Run order on Windows:**

```powershell
cd "C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro"
npm install --legacy-peer-deps
npm run build                      # turbo: builds @pharmacare/* dist/
npm run --workspace @pharmacare/desktop typecheck
npm run --workspace @pharmacare/desktop test
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Fixes shipped (all on disk)

| # | Bug | Fix |
| ---: | --- | --- |
| 1 | `cargo check` panic — `migration numbering gap: expected 39, found 44` in `build.rs:87` | Renamed `0044_whatsapp_outbox.sql` → `0039_whatsapp_outbox.sql` |
| 2 | `npm install` ERESOLVE — `react-native@0.76.0` peer wants react `^18.2.0`, mobile pkgs pinned `react@19.2.5` | Downgraded `apps/mobile/{cashier,owner,customer,rider}/package.json` react to `18.3.1` (compatible with RN 0.76) |
| 3 | tsc — 69 lucide icons missing from ambient `lucide-react.d.ts` | Added `Mic, Bot, Snowflake, CreditCard, HeartHandshake, Boxes, PuzzleIcon, Trash2, ScrollText, Building2, FileDown, KeyRound, Monitor, Leaf, AlertTriangle, Loader2, Info, ShieldAlert, Send, ListChecks, FileSpreadsheet, Shield, Cpu, Tag, Coins, ChevronUp, FileSearch, Wrench, Box, Wifi, BatteryCharging, Fingerprint, MessageSquare, Share2, ShoppingCart, LineChart, ExternalLink, UserCog, Clock, RotateCw, SendHorizontal, …` (69 total) |
| 4 | tsc — `Type '"default"' is not assignable to type 'Variant'` (Button) used by 6 screens | Added `"default"` to `Variant` union and `variantStyles` (mirrors primary) |
| 5 | tsc — `CashShiftScreen.tsx:97 key={key}` symbol-typed | Cast to `key={String(key)}` |
| 6 | tsc — `RotateCw` not in lucide ambient | Added explicit `RotateCw` declaration |
| 7 | tsc — `featureFlags.ts:65 import.meta.env` | Type-cast `(import.meta as { env?: { DEV?: boolean } }).env?.DEV` |
| 8 | tsc — `BlobPart` Uint8Array<ArrayBufferLike> in CAExportScreen / DataExportScreen | Wrap `new Uint8Array(bytes)` to coerce buffer brand |
| 9 | tsc — `MonitorIcon` not exported (DigitalTwinScreen) | Renamed `MonitorIcon` → `Monitor` |
| 10 | tsc — Glass `padding=` and Badge `tone=` in 5 screens (S12 used old API) | Stripped `padding=` and rewrote `tone=` → `variant=` |

## Still open after this hotfix

These are real but smaller — fix in S14:

- `STATE_TONE` index access can return `undefined` under `exactOptionalPropertyTypes` — minor `as const`/`!` cast needed in DigitalTwinScreen.
- Several `(p) => …` callbacks in screens flag `implicit any` because the upstream package types haven't been built when tsc runs. Solved by `npm run build` first; otherwise add explicit param types.
- 17 vitest test files were failing only because their `@pharmacare/<x>` deps had no `dist/` yet. Building first should resolve all 17.
- `@pharmacare/formulary`, `@pharmacare/pmbjp`, etc.: confirm `package.json` `main` points to `./dist/index.js` and that `npm run build` produces it.

## What's actually verified in the sandbox

- 11 pure-logic vitest packages still 219/219 green.
- `tsc -p _tscheck_s13.json --strict --exactOptionalPropertyTypes` on the 9 S13-touched files: **0 errors**.
- Migration sequence is now contiguous 1…39.

---

## Round-2 hotfixes (after second Windows run)

`cargo check` is now GREEN. Remaining failures all root-cause to four issues:

| # | Bug | Fix |
| ---: | --- | --- |
| 11 | `turbo run build` fails "node_modules_root" lock on Windows | Repointed all 56 private workspace packages' `package.json` `main`/`types`/`exports` from `./dist/index.js` to `./src/index.ts`. Vite/Vitest+TS-bundler-resolution follow this directly — no build step needed for workspace packages. (Each pkg keeps its own `build` script for stand-alone publish if ever needed.) |
| 12 | `@testing-library/react@16` requires sibling `@testing-library/dom` peer install | Added `@testing-library/dom@^10.4.0` and `@testing-library/user-event@^14.5.2` to `apps/desktop/package.json` devDeps. **Run `npm install --legacy-peer-deps` again** after pulling. |
| 13 | `cargo test` — `SavePartialReturnInput` test missing `idempotency_token`, `request_hash` | Added the two `: None` fields to `make_return_input` |
| 14 | DigitalTwinScreen `Record<AssetKind, React.ComponentType<{size?: number}>>` mismatches `LucideIcon` (size accepts `string \| number`) | Changed annotation to `Record<AssetKind, LucideIcon>`; imported `type LucideIcon` |
| 15 | DigitalTwinScreen `STATE_TONE[a.state]` index can be undefined under exactOptional | Cast with `(STATE_TONE[a.state] ?? "neutral") as ...` |
| 16 | BillingScreen `ReceiptHeader` exactOptional with `gstin: undefined` | Dropped the explicit-undefined fields |
| 17 | AppShell missing `Building2/Upload/FileDown/KeyRound/RefreshCw/Monitor` imports | Added them to the lucide-react import block |
| 18 | MigrationImport `n` unknown / implicit-any callbacks | Cast `plan.summary as Record<string, number>` + explicit param types |
| 19 | PluginMarketplace `e instanceof InvalidManifestError` on unknown `e` | Cast `(e as Error).message` |
| 20 | CAExportScreen missing `entityType: "llp"` in buildCABundle call | Added |
| 21 | LoyaltyScreen `customerBirthDateIso: customer.birthDateIso` undefined under exactOptional | Spread-conditional `...(customer.birthDateIso ? { customerBirthDateIso: customer.birthDateIso } : {})` |

**Verification:** `tsc --strict --exactOptionalPropertyTypes` over all `apps/desktop/src/**/*.{ts,tsx}` (excluding tests): **0 errors**.
11 package vitest suites: **219/219 green**.

## Next Windows commands

```powershell
cd "C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro"
npm install --legacy-peer-deps                                      # picks up @testing-library/dom + @testing-library/user-event
npm run --workspace @pharmacare/desktop typecheck                   # should be 0 errors
npm run --workspace @pharmacare/desktop test                        # should run all 45 suites green now
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml       # green ✓
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml       # green ✓
```

You can drop the `npm run build` step entirely now — workspace packages are
consumed directly from src/.

---

## Round-3 hotfixes (after third Windows run)

**Cargo: 121/121 ✓** — all green.
**Vitest: 343/375 passed, 9 failed → all fixed.**
**Typecheck: 3 errors → all fixed.**

| # | Bug | Fix |
| ---: | --- | --- |
| 22 | `AllergyAlertModal.test.tsx` / `DDIAlertModal.test.tsx` — `render(<X />)` without required props (TS error + runtime crash on `.filter`/`.some`) | Updated tests to pass `alerts={[…sample…]}` + stub `onAcknowledge`/`onClose`. Switched assertion to `getAllByRole("heading").length > 0`. |
| 23 | 7 scaffold tests fail because `getByRole("heading")` finds h1 + h2 + h3 (multiple headings) | Updated all 7 to `getByRole("heading", { level: 1 })`: CashShiftScreen, CFDDisplay, DigitalTwinScreen, FamilyVaultScreen, LoyaltyScreen, PluginMarketplaceScreen, RBACScreen. |
| 24 | "thermal print skipped: TypeError: Cannot read properties of null (reading 'find')" — `lib/printer.ts.resolveThermalPrinter` calls `.find` on null when IPC mock returns null | Added try/catch + null guard around `listInstalledPrinters()`; returns null gracefully if no printers. |
| 25 | `packages/license/src/index.ts:82` — `Uint8Array<ArrayBufferLike>` not BufferSource for `subtle.digest` | Wrapped: `new Uint8Array(bytes)` |

## Expected Windows result after this round

- `npm run --workspace @pharmacare/desktop typecheck`: **0 errors**
- `npm run --workspace @pharmacare/desktop test`: **375/375 passed** (9 failures now fixed; 23 skipped scaffold tests remain skipped intentionally)
- `cargo check`: **green** (4 dead-code warnings only)
- `cargo test`: **121/121 ✓** (already green this round)

---

## ALL GREEN — 2026-04-29 close-out

```
npm run --workspace @pharmacare/desktop typecheck   → 0 errors ✓
npm run --workspace @pharmacare/desktop test        → 45/45 files, 352/352 tests, 23 skipped ✓
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml  → green (4 dead-code warnings only) ✓
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml  → 121/121 ✓
```

**Total fixes across all four rounds: 25 distinct breakages.**

S13 is now ship-ready end-to-end. Next steps for Sourav:
1. `git add -A && git commit -m "feat(s13): integration sprint — wire ShiftHandover/Printer/WhatsApp/Reorder/ExpiryDiscard live IPC + 25-fix hotfix bundle"` (or split into smaller commits for review).
2. `git push` and open the PR.
3. S14 punch list:
   - Settings → Printer screen UI (helpers in `lib/printer.ts` ready)
   - photo-grn Tauri command + wire `PhotoBillCapture` (X3 ADR-0024)
   - BillingScreen "Share via WhatsApp" button on the post-save toast
   - Real PDF renderer for ShiftHandoverPreview Save PDF
   - Wipe the act() warnings (low priority)

## Cumulative lesson (carry forward)

The Windows-mount truncation bug (file `Edit`/`Write` silently drops trailing
lines on `C:\Users\Jagannath Pharmacy\ClaudeWorkspace\…`) is the single biggest
hazard in this repo. Round-1 lost 100+ chars from main.rs, ipc.ts, lib/whatsapp.ts.
**Always use `cat > file <<'EOF'` heredoc + `wc -lc` verify for files >300 LoC,
or `python3 - <<'PYEOF'` with `read_text/write_text(encoding='utf-8')` for
surgical patches.**
