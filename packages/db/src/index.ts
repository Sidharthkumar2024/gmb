import { PrismaClient } from "@prisma/client";

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
