import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No DOM needed here — sku-images is pure TS. Node env is the fastest
    // path and dodges jsdom's partial crypto stub entirely.
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
