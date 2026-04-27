# ADR 0028 — Multi-store Parent / Worker gRPC Topology

> **STATUS: DRAFT** (2026-04-27)

**Status:** DRAFT
**Date:** 2026-04-27
**Relates to:** Build playbook v2.0 §8.1 (locked tech: gRPC parent↔worker), §3 (multi-store first-class)

---

## Context

Playbook v2.0 §3 — multi-store / franchise pharmacy is a first-class
ICP. Day-1 pilot is a single-store install. Cohorts 2-50 are also
single-store. Cohorts 50+ start including 2-5-store independents and
the first franchise candidates (Wellness Forever, MedPlus etc.).

The single-store binary today owns its full SQLite locally. Adding a
naive cloud-sync between stores would violate playbook §6 (PII never
leaves shop LAN without per-feature opt-in) and add a single point of
failure for every shop.

The §8.1 "locked decision" is **gRPC parent ↔ worker**: each store
runs a worker (the existing single-store binary), one designated
shop runs the parent (an additional Go-microservice), and parents
sync to workers over gRPC across the LAN (or VPN if multi-city).

---

## Decision

### Topology

```
                    Parent shop (e.g. owner's office)
                         |
                    Parent service (Go)
                    SQLite + gRPC server
                         |
         +---------------+---------------+
         |               |               |
     Worker shop 1   Worker shop 2   Worker shop 3
     (PharmaCare     (PharmaCare     (PharmaCare
      desktop +       desktop +       desktop +
      gRPC client)    gRPC client)    gRPC client)
```

- **Single-store deploys (Day-1 → ~50 shops):** worker only, no
  parent. Behaviour identical to today's binary.
- **Multi-store deploys (post pilot):** one parent service per chain,
  workers connect to it. Parent owns: SKU master, supplier master,
  customer master (if multi-store-shared), price lists. Workers own:
  bills, GRNs, payments, returns, IRN records (per-store independent).

### gRPC service surface (initial)

```proto
service ParentService {
  // Master data sync (parent → worker, push)
  rpc StreamProductUpdates(StreamProductUpdatesReq) returns (stream ProductUpdate);
  rpc StreamSupplierUpdates(StreamSupplierUpdatesReq) returns (stream SupplierUpdate);
  rpc StreamPriceListUpdates(StreamPriceListUpdatesReq) returns (stream PriceListUpdate);

  // Telemetry (worker → parent, push)
  rpc PostBillEvent(BillEvent) returns (Ack);
  rpc PostGrnEvent(GrnEvent) returns (Ack);
  rpc PostStockEvent(StockEvent) returns (Ack);

  // Health + reconcile
  rpc Heartbeat(HeartbeatReq) returns (HeartbeatResp);
  rpc ReconcileSku(ReconcileSkuReq) returns (ReconcileSkuResp);
}
```

### Conflict resolution

- **SKU master:** parent wins, last-writer-wins per field. Workers
  cache and apply on stream update.
- **Bills / GRNs / payments:** workers always own these — never
  pushed back to parent's authoritative table; only event-stream
  copies for parent dashboard reporting.
- **Stock:** per-store, owned by worker. Parent has read-only mirror.

### LAN-first / VPN

- Parent + workers in the same retail park: plain gRPC over LAN.
- Multi-city chain: parent runs in a small AWS ap-south-1 instance,
  workers connect via Tailscale or WireGuard (operator's choice).
- mTLS for all gRPC calls. Per-shop certs issued by the parent at
  worker pairing time.

### Data model
Parent runs the same SQLite schema as the worker, plus an additional
`worker_registry` table:

```sql
CREATE TABLE worker_registry (
  shop_id        TEXT PRIMARY KEY REFERENCES shops(id),
  display_name   TEXT NOT NULL,
  paired_at      TEXT NOT NULL,
  last_heartbeat TEXT,
  cert_fingerprint TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('active','paused','offline','unpaired'))
);
```

---

## Alternatives considered

1. **Cloud-DB-as-source-of-truth.** Rejected — playbook §6, plus
   single-cloud-failure cripples N stores.
2. **CRDT-based eventual consistency.** Considered, but hot-loop SKU
   master changes infrequently; LWW is simpler and sufficient.
3. **WebSocket fan-out instead of gRPC.** Rejected — gRPC's
   schema-first is critical for multi-vendor compatibility.

---

## Consequences

### Positive
- Multi-store is a first-class deploy mode, not a hack.
- Single-store binary is unchanged for the first 50 cohorts.
- Each store keeps full LAN-local autonomy; parent outage doesn't
  stop billing.

### Negative
- Adds a Go microservice + Tailscale/WireGuard dep at multi-store
  scale.
- gRPC schema versioning + mTLS cert ops is a sprint of work each
  in its own right.

---

## Test strategy

1. **Single-store mode** (no parent) — every existing test continues
   to pass. New `--multi-store` config flag defaults to false.
2. **Parent + 1 worker** — SKU update on parent → worker SQLite
   reflects within 5s (heartbeat interval).
3. **Worker offline + back online** — parent buffers updates,
   delivers all pending on reconnect.
4. **Conflicting writes** — last-writer-wins on SKU; no data loss
   on bills/GRNs (worker-owned).
5. **mTLS cert revocation** — paused worker can't accept new
   updates; existing cache still functions.

---

## Build phases

| Phase | Scope | Effort |
|---|---|---|
| Phase 1 (this ADR) | DRAFT | THIS COMMIT |
| Phase 2 | Go parent service skeleton + protobuf schema | ~3 sessions |
| Phase 3 | Rust gRPC client in worker binary | ~2 sessions |
| Phase 4 | Pairing flow + mTLS cert issuance | ~2 sessions |
| Phase 5 | Master-data streaming RPCs | ~3 sessions |
| Phase 6 | Telemetry RPCs + parent dashboard UI | ~3 sessions |

Total: ~13 sessions. Defer until 5+ multi-store pilots are signed.
