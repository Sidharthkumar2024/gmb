import IORedis from "ioredis";

// Cross-process worker liveness. The process that runs the BullMQ workers writes
// a short-TTL key to Redis on a timer; any other process (e.g. a web-only
// instance) reads it to report whether workers are ACTUALLY alive — instead of
// echoing its own ENABLE_WORKERS env flag, which is wrong in a split
// web/worker deployment. Best-effort throughout: if Redis is unreachable the
// health check reports "not alive" rather than hanging or throwing.

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const KEY = "gmb:workers:alive";
const TTL_SECONDS = 90; // key expires this long after the last refresh
const REFRESH_MS = 30_000; // refresh well inside the TTL

let client: IORedis | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function redis(): IORedis {
  if (!client) {
    client = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
    // A liveness probe must never crash the process on a Redis blip.
    client.on("error", () => undefined);
  }
  return client;
}

/** Begin publishing the worker heartbeat. Call from the worker-running process. */
export async function startWorkerHeartbeat(): Promise<void> {
  const write = async () => {
    try {
      await redis().set(KEY, String(Date.now()), "EX", TTL_SECONDS);
    } catch {
      // best-effort — a failed refresh just lets the key lapse to "not alive"
    }
  };
  await write();
  if (!timer) {
    timer = setInterval(() => void write(), REFRESH_MS);
    timer.unref?.(); // don't keep the process alive for the heartbeat alone
  }
}

/** Stop the heartbeat and clear the key (graceful shutdown). */
export async function stopWorkerHeartbeat(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  try {
    await client?.del(KEY);
  } catch {
    // ignore
  }
  try {
    await client?.quit();
  } catch {
    // ignore
  }
  client = null;
}

/** True when a worker process has refreshed the heartbeat within the TTL. */
export async function isWorkersAlive(): Promise<boolean> {
  try {
    const exists = await Promise.race([
      redis().exists(KEY),
      new Promise<number>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    return exists === 1;
  } catch {
    return false;
  }
}
