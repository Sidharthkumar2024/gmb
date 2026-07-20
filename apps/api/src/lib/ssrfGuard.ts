import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

function isPrivateIpv4(a: number, b: number, _c: number): boolean {
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailscale-like
  return false;
}

function isPrivateIpv6(parts: string): boolean {
  const p = parts.toLowerCase();
  if (p === "::1" || p === "0:0:0:0:0:0:0:1") return true;
  if (p.startsWith("fc") || p.startsWith("fd")) return true; // ULA
  if (p.startsWith("fe80")) return true; // link-local
  return false;
}

function assertIpNotPrivate(address: string): void {
  if (address.includes(":")) {
    if (isPrivateIpv6(address)) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        "Webhook URL resolves to a private or link-local address.",
      );
    }
    return;
  }
  const parts = address.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return;
  if (isPrivateIpv4(parts[0], parts[1], parts[2])) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Webhook URL resolves to a private or link-local address.",
    );
  }
}

/**
 * Blocks SSRF targets in flow WEBHOOK nodes (T-011): private IPs, localhost,
 * cloud metadata hosts, non-http(s) schemes.
 */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Webhook URL is invalid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Webhook URL must use http or https.",
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost")) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Webhook URL host is not allowed.");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    assertIpNotPrivate(host);
    return parsed;
  }
  if (host.includes(":")) {
    assertIpNotPrivate(host);
    return parsed;
  }
  const records = await Promise.race([
    lookup(host, { all: true }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DNS lookup timed out")), 3000),
    ),
  ]).catch(() => {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Webhook URL host could not be verified.",
    );
  });
  for (const rec of records) {
    assertIpNotPrivate(rec.address);
  }
  return parsed;
}
