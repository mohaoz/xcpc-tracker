import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  define: {
    "import.meta.env.BASE_URL": JSON.stringify("/"),
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "happy-dom",
    setupFiles: ["tests/unit/setup.ts"],
    restoreMocks: true,
  },
});
