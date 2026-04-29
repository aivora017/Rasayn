# @pharmacare/idempotency

UUIDv7 + canonical request hashing for idempotent Tauri commands. Closes ADR-0030 / coverage gap C03.

## Why
Network retries and double-clicks can submit the same `save_bill` / `save_grn` / `save_partial_return` twice. That's a duplicate financial entry — silent loss / overcharge.

## What
- `uuidv7()` — time-ordered token, sortable by index, generated client-side.
- `canonicalRequestHash(payload)` — SHA-256 of JSON with keys sorted; detects same-token-different-payload bugs.
- `IdempotencyConflictError` — thrown when a token is replayed with a different payload.
- `expiresAt(createdAtMs)` — ISO8601 of `createdAt + 24h` (matches DB TTL).

## How
1. Client (TS) generates `idempotencyToken = uuidv7()` before invoking a write command.
2. Client computes `requestHash = canonicalRequestHash(payload)` and sends both with the command.
3. Server (Rust) selects `idempotency_tokens` by `token`:
   - **Hit + matching hash** → replay cached `response_json` (no DB writes).
   - **Hit + different hash** → return `IDEMPOTENCY_CONFLICT`.
   - **Miss** → run the command transactionally, then INSERT the row with `(token, command, request_hash, response_json, expires_at)`.
4. Nightly GC purges rows where `expires_at < now()`.

## Tests
24 cases covering UUID well-formedness, time-sortability, key-order invariance, array order sensitivity, conflict error contract, TTL math.
