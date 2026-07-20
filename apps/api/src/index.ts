import express from "express";
import cors from "cors";
import helmet from "helmet";
import { prisma } from "@nexaflow/db";

import { errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import gmbRoutes from "./routes/gmb.routes";

import {
  startGmbAutoSyncWorker,
  stopGmbAutoSyncWorker,
} from "./services/gmbAutoSync.service";
import {
  startGmbAutopilotWorker,
  stopGmbAutopilotWorker,
} from "./services/gmbAutopilotScheduler.service";
import {
  startGmbPostPublisherWorker,
  stopGmbPostPublisherWorker,
} from "./services/gmbPostPublisher.service";
import {
  startGmbReportScheduleWorker,
  stopGmbReportScheduleWorker,
} from "./services/gmbReportScheduler.service";

const app = express();
const PORT = Number(process.env.API_PORT ?? 3001);

app.use(helmet());
app.use(
  cors({
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    credentials: true,
  }),
);
// Branded post images and report PDFs are sizeable; the default 100kb limit
// rejects them.
app.use(express.json({ limit: "5mb" }));

app.get("/api/v1/health", async (_req, res) => {
  // Report DB reachability rather than just "the process is up" — an API that
  // answers 200 while Postgres is down is worse than one that fails.
  let database = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    database = `error: ${(err as Error).message}`;
  }
  res.status(database === "ok" ? 200 : 503).json({
    success: database === "ok",
    data: { status: database === "ok" ? "ok" : "degraded", database, uptime: process.uptime() },
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/gmb", gmbRoutes);

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Route not found." },
  });
});

app.use(errorHandler);

/**
 * Background workers are opt-in. Running them in every process would mean each
 * replica independently syncing Google and publishing posts — duplicate writes
 * against a rate-limited API. Enable on exactly one worker process.
 */
function workersEnabled(): boolean {
  return (process.env.ENABLE_WORKERS ?? "false").toLowerCase() === "true";
}

async function startWorkers(): Promise<void> {
  if (!workersEnabled()) {
    console.log("[workers] disabled (set ENABLE_WORKERS=true to run them)");
    return;
  }
  await Promise.all([
    startGmbAutoSyncWorker(),
    startGmbAutopilotWorker(),
    startGmbPostPublisherWorker(),
    startGmbReportScheduleWorker(),
  ]);
  console.log("[workers] GMB auto-sync, autopilot, post publisher, report scheduler started");
}

async function stopWorkers(): Promise<void> {
  if (!workersEnabled()) return;
  await Promise.allSettled([
    stopGmbAutoSyncWorker(),
    stopGmbAutopilotWorker(),
    stopGmbPostPublisherWorker(),
    stopGmbReportScheduleWorker(),
  ]);
}

const server = app.listen(PORT, () => {
  console.log(`[api] GMB API listening on http://localhost:${PORT}`);
  void startWorkers().catch((err) => {
    console.error("[workers] failed to start:", err);
  });
});

// Drain in-flight requests and let workers finish their current job before the
// process exits, so a deploy doesn't abandon a half-published post.
async function shutdown(signal: string): Promise<void> {
  console.log(`[api] ${signal} received, shutting down`);
  server.close();
  await stopWorkers();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { app };
