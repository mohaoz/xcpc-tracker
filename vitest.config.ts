import { defineConfig } from "vitest/config";

// Tests for build-time and data-maintenance tools in scripts/ and for the
// canonical catalog data. Frontend unit tests live in web/ (web/vitest.config.ts).
export default defineConfig({
  test: {
    include: ["tests/tools/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
  },
});
