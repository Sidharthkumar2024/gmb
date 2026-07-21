import type { NextFunction, Response } from "express";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import type { RequestWithAuth } from "./auth";

// In-process fixed-window rate limiter for the unauthenticated auth endpoints.
//
// Scope, stated plainly: this is per-process. Behind N replicas the effective
// limit is N x max. That is fine for its actual job — blunting credential
// stuffing and reset-email spam from a single source — but it is not a
// correctness boundary. Move to Redis (the queue connection is already here)
// before treating it as one.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bounded sweep so a long-running process cannot accumulate a bucket per IP
// seen. Runs on write, not on a timer, so an idle process stays idle.
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

function clientKey(req: RequestWithAuth): string {
  const forwarded = (req.headers["x-forwarded-for"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  return forwarded ?? req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export interface RateLimitOptions {
  /** Requests allowed per window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /**
   * Include this request-body field in the key (e.g. "email"), so one attacker
   * cannot lock out every user from one IP, and one email cannot be attacked
   * from many IPs without also tripping the per-IP bucket.
   */
  keyOn?: string;
  name: string;
}

export function rateLimit(opts: RateLimitOptions) {
  return (req: RequestWithAuth, res: Response, next: NextFunction): void => {
    const now = Date.now();
    sweep(now);

    const extra =
      opts.keyOn && req.body && typeof req.body === "object"
        ? String((req.body as Record<string, unknown>)[opts.keyOn] ?? "").toLowerCase()
        : "";
    const key = `${opts.name}:${clientKey(req)}:${extra}`;

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowSeconds * 1000 });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      next(
        new ApiError(
          ErrorCodes.RATE_LIMITED,
          429,
          `Too many attempts. Try again in ${retryAfter}s.`,
        ),
      );
      return;
    }
    next();
  };
}

/** Test hook — drop all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
