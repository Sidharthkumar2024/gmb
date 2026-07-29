import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

// Audit writes must never break the request they describe: a DB failure is
// swallowed, not thrown. Client metadata comes from the proxy header first.

const deps = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return { ...actual, prisma: { auditLog: { create: deps.create } } };
});

import { extractRequestMeta, logAudit } from "./audit.service";

afterEach(() => vi.clearAllMocks());

describe("logAudit", () => {
  it("maps fields and JSON-stringifies old/new values", async () => {
    deps.create.mockResolvedValue({});
    await logAudit({
      tenantId: "t1",
      userId: "u1",
      action: "UPDATE",
      resource: "branding",
      resourceId: "b1",
      oldValues: { logoUrl: null },
      newValues: { logoUrl: "https://x/y.png" },
      ipAddress: "1.2.3.4",
      userAgent: "curl",
    });
    expect(deps.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "t1",
        userId: "u1",
        action: "UPDATE",
        resource: "branding",
        resourceId: "b1",
        oldValues: '{"logoUrl":null}',
        newValues: '{"logoUrl":"https://x/y.png"}',
        ipAddress: "1.2.3.4",
        userAgent: "curl",
      }),
    });
  });

  it("nulls the optional fields when omitted", async () => {
    deps.create.mockResolvedValue({});
    await logAudit({ tenantId: "t1", userId: "u1", action: "LOGIN", resource: "auth" });
    expect(deps.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceId: null,
        oldValues: null,
        newValues: null,
        ipAddress: null,
        userAgent: null,
      }),
    });
  });

  it("swallows DB errors so an audit failure never breaks the caller", async () => {
    deps.create.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      logAudit({ tenantId: "t1", userId: "u1", action: "DELETE", resource: "x" }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

function fakeReq(headers: Record<string, string>, ip?: string, remoteAddress?: string): Request {
  return {
    headers,
    ip,
    socket: { remoteAddress },
  } as unknown as Request;
}

describe("extractRequestMeta", () => {
  it("takes the first hop from x-forwarded-for", () => {
    const meta = extractRequestMeta(fakeReq({ "x-forwarded-for": "1.1.1.1, 2.2.2.2", "user-agent": "UA" }));
    expect(meta).toEqual({ ipAddress: "1.1.1.1", userAgent: "UA" });
  });

  it("falls back to req.ip then the socket address", () => {
    expect(extractRequestMeta(fakeReq({}, "9.9.9.9")).ipAddress).toBe("9.9.9.9");
    expect(extractRequestMeta(fakeReq({}, undefined, "8.8.8.8")).ipAddress).toBe("8.8.8.8");
  });

  it("defaults to 'unknown' when nothing is available", () => {
    expect(extractRequestMeta(fakeReq({}))).toEqual({ ipAddress: "unknown", userAgent: "unknown" });
  });
});
