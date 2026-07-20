import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@nexaflow/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@nexaflow/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
    },
  },
  test: { include: ["apps/api/src/**/*.test.ts"], environment: "node" },
});
