import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { app } from "./app";

// HTTP contract tests: drive the REAL Express app (all middleware + routes)
// through an ephemeral server, so the wiring is exercised end to end — not the
// handlers in isolation. These paths need no DB/Redis: they assert that unknown
// routes 404 cleanly, protected routes demand auth before doing any work, and
// the public payment webhook refuses an unsigned request (the crediting path is
// gated behind signature verification).

let server: Server;
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

describe("app HTTP contract", () => {
  it("returns a 404 JSON envelope for an unmatched route", async () => {
    // A path outside /api/v1 reaches the terminal 404 handler. (Unknown paths
    // UNDER /api/v1 instead hit the version-root workspace router and 401 on
    // auth first — asserted separately below.)
    const res = await fetch(`${base}/no-such-path`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  it("401s (not 404s) an unknown path under /api/v1 — the version-root router requires auth", async () => {
    const res = await fetch(`${base}/api/v1/definitely-not-a-route`);
    expect(res.status).toBe(401);
  });

  // Every one of these sits behind requireAuth (directly or via a router-level
  // guard); with no Authorization header the request must be rejected before any
  // DB access.
  it.each([
    "/api/v1/auth/me",
    "/api/v1/gmb/locations",
    "/api/v1/admin/overview",
    "/api/v1/partner/overview",
  ])("requires authentication for GET %s", async (path) => {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  it("rejects an unsigned Razorpay webhook with 401 (no crediting without a valid signature)", async () => {
    const res = await fetch(`${base}/api/v1/billing/webhook/razorpay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "payment.captured", payload: { payment: { entity: {} } } }),
    });
    expect(res.status).toBe(401);
  });

  it("serves the health endpoint (shape is stable even if the DB is down)", async () => {
    const res = await fetch(`${base}/api/v1/health`);
    // 200 when the DB answers, 503 when it doesn't — both are valid contract
    // responses; assert the envelope shape rather than requiring a live DB.
    expect([200, 503]).toContain(res.status);
    const body = (await res.json()) as { data: { status: string; database: string } };
    expect(body.data).toHaveProperty("status");
    expect(body.data).toHaveProperty("database");
  });
});
