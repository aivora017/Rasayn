# ADR-001: Monorepo with Turborepo

**Date:** 2026-04-14
**Status:** Accepted
**Supersedes:** \u2014

## Context
PharmaCare Pro spans desktop (Tauri), mobile (RN), web (Next.js), and cloud (Go) with shared TS packages (types, GST engine, compliance). Playbook v2.0 \u00a78.1 locks the tech stack but leaves repo topology to this ADR.

## Decision
Single monorepo managed by **Turborepo 2.x** with npm workspaces. Layout:

```
apps/{desktop,mobile,web,cloud-services}
packages/{shared-types,gst-engine,schedule-h,crypto}
infra/  docs/adr/  .github/workflows/
```

Go services live under `apps/cloud-services` as a separate Go module; Turbo only orchestrates JS/TS packages and invokes Go via `go` tasks.

## Consequences
+ Single PR can update shared-types + every consumer atomically.
+ Turbo remote cache cuts CI time; local cache speeds desktop dev.
+ Shared lint/tsconfig baseline enforces consistency.
- New engineers need to learn Turbo task graph.
- Go + TS in one repo requires split CI jobs.

## Alternatives considered
- **Polyrepo per app** \u2014 rejected: version drift on shared types / GST rules is unacceptable for a compliance product.
- **Nx** \u2014 rejected: heavier, more opinionated; Turbo is lighter and sufficient.
- **pnpm workspaces without Turbo** \u2014 rejected: no task graph caching.
