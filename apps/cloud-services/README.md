# @pharmacare/cloud-services

**Go microservices for the cloud spine** — multi-tenant Postgres + RLS, NATS JetStream queues, Cloudflare Tunnel inbound from desktop workers, S3 backups.

## Status
**SCAFFOLD** — directory structure only. Service-by-service implementation per ADRs 0028 (multi-store), 0048 (AI Copilot gateway), 0050 (cold-chain ingest), 0053 (DPDP DSR queue), 0065 (telemetry).

## Services planned
- `cmd/sync-relay`         — NATS JetStream relay between desktop workers and Postgres
- `cmd/copilot-gateway`    — LiteLLM-style gateway (Opus 4.7 / Sonnet 4.6 / Sarvam-Indus) with per-tenant budget caps + Cube.dev semantic layer
- `cmd/dsr-worker`         — DPDP DSR fulfillment queue
- `cmd/cold-chain-ingest`  — receives BLE-sensor batches via NATS, persists, raises excursions
- `cmd/forecast-trainer`   — nightly Prophet+LSTM training per shop
- `cmd/fraud-scanner`      — nightly Isolation Forest run
- `cmd/abdm-bridge`        — proxy to NHA gateway with consent token storage in AWS KMS
- `cmd/whatsapp-webhook`   — Gupshup + Meta CAPI delivery callbacks
- `cmd/pmbjp-refresher`    — nightly catalog scrape

## Stack
- Go 1.23
- pgx (Postgres)
- nats.go (JetStream)
- otelgrpc (OTel exporter to Grafana Cloud)
- AWS SDK v2 (S3, KMS)
