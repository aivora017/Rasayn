# A1 SKU Master — hand-off

Branch target: `feat/a1-sku-master`
Baseline: `de9ce0f` on `main`
ADR: `docs/adr/0004-a1-a16-pos-readiness-plan.md` (row A1)

## What's in this changeset

| Layer | File | Purpose |
|---|---|---|
| Migration | `packages/shared-db/migrations/0006_products_nppa_cap.sql` | NPPA cap column, HSN whitelist triggers, NPPA cap guard trigger, `idx_products_active_name` |
| DB runtime | `apps/desktop/src-tauri/src/db.rs` | Register + apply migration 0006 |
| Types | `packages/shared-types/src/product.ts` | `Product.nppaMaxMrpPaise: Paise \| null` |
| Validators | `packages/shared-types/src/validators.ts` + index | HSN, GST-rate, NPPA cap, Schedule image, composite `validateProductWrite` |
| Tauri | `apps/desktop/src-tauri/src/products.rs` | `upsert_product`, `get_product`, `list_products`, `deactivate_product` + 5 unit tests |
| Tauri wiring | `apps/desktop/src-tauri/src/main.rs` | Module + invoke-handler registration |
| Perf probe | `apps/desktop/src-tauri/src/products_perf.rs` | `seed_200_and_list_under_500ms` (gate: <500 ms seed, <50 ms count) |
| IPC | `apps/desktop/src/lib/ipc.ts` | `ProductRow`, `ProductWriteDTO`, `ListProductsArgs` + 4 RPC helpers |
| UI | `apps/desktop/src/components/ProductMasterScreen.tsx` | Keyboard-first CRUD screen |
| UI wiring | `apps/desktop/src/App.tsx` | `F11 → Masters` mode |
| Tests | `packages/shared-types/src/validators.test.ts` | 17 assertions covering validators |

## Sandbox gate results (2026-04-16, this session)

| Gate | Result |
|---|---|
| `tsc --noEmit` on `packages/shared-types` | clean |
| `tsc --noEmit` on `apps/desktop` | clean (after 3 fixes: `listProductsRpc` conditional-spread for `q`, DTO conditional-spread for `id`, `validateProductWrite` cast through `unknown` for branded `Paise`) |
| `vitest` on `packages/shared-types` | 24/24 (17 validator + 7 index) |
| `vitest` on `apps/desktop` | 47/47 |
| `cargo test` + `clippy` + `fmt` | **pending — must run on Windows side** |
| `cargo test --release products_perf` | **pending — capture as `docs/evidence/a1/perf.json`** |

## Local gate sequence (run on Windows side — sandbox bash can't run cargo)

```powershell
cd C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro
git checkout -b feat/a1-sku-master
git add -A
git status

# Gates
cd packages\shared-types ; npm test ; cd ..\..
cd apps\desktop\src-tauri ; cargo test ; cargo clippy --all-targets -- -D warnings ; cargo fmt --check ; cd ..\..\..
cd apps\desktop ; npm test ; cd ..\..

# Perf probe — capture evidence
cd apps\desktop\src-tauri
cargo test --release products_perf -- --nocapture | Select-String '"probe"' > ..\..\..\docs\evidence\a1\perf.json
cd ..\..\..

# Commit
git -c user.name=aivora017 -c user.email=aivora017@gmail.com commit -m "feat(a1): SKU master CRUD + NPPA cap + HSN guard

- migration 0006: nppa_max_mrp_paise col, HSN whitelist triggers (3003/3004/3005/3006/9018),
  NPPA cap guard triggers, idx_products_active_name
- shared-types: Product.nppaMaxMrpPaise, validators.ts (17 tests)
- products.rs: upsert/get/list/deactivate Tauri commands + 5 tests
- ProductMasterScreen.tsx: keyboard-first CRUD (Alt+N/S/D, F11 to enter)
- products_perf.rs: 200-SKU seed gate <500ms

Closes A1 per ADR 0004."
git push -u origin feat/a1-sku-master
```

## Acceptance evidence to capture before merging

Put under `docs/evidence/a1/`:

- `perf.json` — probe output line
- `tests.txt` — `cargo test` + `npm test` full logs
- `ui.png` — screenshot of Product Master with ≥3 rows

## Notes / known follow-ups

- ID generation uses `time-millis + ns-suffix`. Good enough for local; a later branch will move to ULID across the repo.
- `list_products` uses `LIKE '%q%'` over `products` directly (not FTS5). Fine for master-screen scale (≤ few thousand SKUs). Sale-side search continues to use the FTS5 view via `search_products`.
- `F11` chosen because F1–F8 are taken and F9/F10 collided with child-screen save handlers in the past. If F11 collides with OS full-screen on some WM, switch to `Ctrl+Shift+M` in a follow-up.
- Did NOT add a new `@pharmacare/product-repo` package — inlined in `products.rs` to keep A1 diff tight. Extract when a second consumer (cloud-services) needs the same writes.
- `ProductMasterScreen.tsx` casts DTO to the validator input through `unknown` because shared-types ships a branded `Paise` (`{ readonly __brand: "Paise" }`) while IPC carries raw `number`. A follow-up ADR (A-misc) should decide whether to drop the brand, export a branded constructor (e.g. `Paise.of(x)`), or dual-type the validator. Not a blocker for A1.
