import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

// Load the repo-root .env before the client reads DATABASE_URL. Done here
// rather than in each entrypoint because every process that touches the
// database imports this module — server, workers, seed and tests alike.
// `override: false` keeps real environment variables (CI, production) winning
// over a stray local file.
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
  override: false,
});

// Re-export everything Prisma generates (models, enums, the `Prisma` namespace)
// so the extracted GMB code's `import { GmbPostStatus, Prisma } from
// "@nexaflow/db"` keeps working unchanged.
export * from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __gmbPrisma: PrismaClient | undefined;
}

// One client per process. Cached on globalThis so Next.js dev hot-reloads and
// repeated test imports don't open a new connection pool each time.
export const prisma =
  globalThis.__gmbPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__gmbPrisma = prisma;
}
