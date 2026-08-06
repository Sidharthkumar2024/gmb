import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nexaflow/db": path.resolve(projectRoot, "packages/db/src/index.ts"),
      "@nexaflow/shared": path.resolve(projectRoot, "packages/shared/src/index.ts"),
    },
  },
  test: {
    include: ["apps/api/src/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    environment: "node",
  },
});
