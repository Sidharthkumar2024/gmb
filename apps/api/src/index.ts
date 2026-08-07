import { prisma } from "@nexaflow/db";

import { app } from "./app";
import { validateEnvOrExit } from "./lib/validateEnv";
import {
  primeGoogleOAuthCache,
  getCachedGoogleClientConfig,
} from "./services/googleOAuthConfig.service";

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
import {
  startPartnerInvoiceWorker,
  stopPartnerInvoiceWorker,
} from "./services/partnerInvoice.service";
import { startWorkerHeartbeat, stopWorkerHeartbeat } from "./lib/workerHeartbeat";
import { startGmbRankScheduleWorker, stopGmbRankScheduleWorker } from "./services/gmbRankScheduler.service";

// Validate configuration before anything binds a port or serves a request. In
// production a missing/weak critical var aborts here with a clear list; in
// dev/test it only warns so fallbacks keep working.
validateEnvOrExit();

const PORT = Number(process.env.API_PORT ?? 3001);

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
    startGmbRankScheduleWorker(),
    startPartnerInvoiceWorker(),
  ]);
  // Publish a cross-process liveness heartbeat so /admin/health reports true
  // worker status even when web and workers run as separate instances.
  await startWorkerHeartbeat();
  console.log(
    "[workers] GMB auto-sync, autopilot, post publisher, report scheduler, partner invoice started",
  );
}

async function stopWorkers(): Promise<void> {
  if (!workersEnabled()) return;
  await Promise.allSettled([
    stopGmbAutoSyncWorker(),
    stopGmbAutopilotWorker(),
    stopGmbPostPublisherWorker(),
    stopGmbReportScheduleWorker(),
    stopGmbRankScheduleWorker(),
    stopPartnerInvoiceWorker(),
    stopWorkerHeartbeat(),
  ]);
}

const server = app.listen(PORT, () => {
  console.log(`[api] GMB API listening on http://localhost:${PORT}`);
  // Load the stored Google OAuth client into the in-process cache. Without
  // this the cache stays null and every OAuth call silently falls back to env
  // credentials, so a client saved through the admin path would never be used.
  void primeGoogleOAuthCache()
    .then(() => {
      const cfg = getCachedGoogleClientConfig();
      console.log(
        cfg
          ? "[google] OAuth client loaded from the encrypted config"
          : "[google] no stored OAuth client — falling back to env credentials",
      );
    })
    .catch((err) => console.warn("[google] failed to prime OAuth cache:", err));
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
