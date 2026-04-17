// Vitest workspace — tells the root `vitest run` how to discover project
// configs across the monorepo. Each entry is a project directory that
// contains either a vite.config.ts (with a `test` block) or a
// vitest.config.ts. Without this, running vitest from repo root collapses
// every file into a single default config and loses jsdom / setup files.
export default [
  "apps/desktop",
  "packages/batch-repo",
  "packages/bill-repo",
  "packages/crypto",
  "packages/directory-repo",
  "packages/gmail-inbox",
  "packages/grn-repo",
  "packages/gst-engine",
  "packages/gstr1",
  "packages/reports-repo",
  "packages/schedule-h",
  "packages/search-repo",
  "packages/seed-tool",
  "packages/shared-db",
  "packages/shared-types",
];
