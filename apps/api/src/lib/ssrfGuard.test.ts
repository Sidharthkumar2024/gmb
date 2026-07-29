import { afterEach, describe, expect, it, vi } from "vitest";

// SSRF guard for outbound webhook URLs: reject bad schemes, blocked hostnames,
// literal private IPs, and — after DNS resolution — hostnames that resolve to a
// private/link-local address. Only public destinations are allowed through.

const deps = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: deps.lookup }));

import { assertSafeOutboundUrl } from "./ssrfGuard";

afterEach(() => vi.clearAllMocks());

describe("assertSafeOutboundUrl — no DNS needed", () => {
  it("rejects an unparseable URL", async () => {
    await expect(assertSafeOutboundUrl("not a url")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects non-http(s) schemes", async () => {
    for (const u of ["ftp://host/x", "file:///etc/passwd", "gopher://h"]) {
      await expect(assertSafeOutboundUrl(u)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it("rejects localhost, *.localhost and cloud metadata hosts", async () => {
    for (const u of [
      "http://localhost/hook",
      "http://api.localhost/hook",
      "http://metadata.google.internal/computeMetadata",
    ]) {
      await expect(assertSafeOutboundUrl(u)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(deps.lookup).not.toHaveBeenCalled(); // short-circuits before DNS
  });

  it("rejects literal private/loopback/link-local IPv4", async () => {
    for (const ip of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0"]) {
      await expect(assertSafeOutboundUrl(`http://${ip}/x`)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it("allows a public literal IPv4 without a DNS lookup", async () => {
    const url = await assertSafeOutboundUrl("https://8.8.8.8/hook");
    expect(url.hostname).toBe("8.8.8.8");
    expect(deps.lookup).not.toHaveBeenCalled();
  });
});

describe("assertSafeOutboundUrl — DNS resolution", () => {
  it("rejects a hostname that resolves to a private address", async () => {
    deps.lookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    await expect(assertSafeOutboundUrl("https://evil.example.com/hook")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("allows a hostname that resolves only to public addresses", async () => {
    deps.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const url = await assertSafeOutboundUrl("https://example.com/hook");
    expect(url.hostname).toBe("example.com");
  });

  it("rejects when DNS resolution fails or times out", async () => {
    deps.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertSafeOutboundUrl("https://nope.example.com/hook")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects if ANY resolved address is private (mixed A records)", async () => {
    deps.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.0.9", family: 4 },
    ]);
    await expect(assertSafeOutboundUrl("https://mixed.example.com/hook")).rejects.toMatchObject({ statusCode: 400 });
  });
});
