import { beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit, resetRateLimits } from "./rateLimit";

function call(mw: ReturnType<typeof rateLimit>, ip: string, body: unknown = {}) {
  const next = vi.fn();
  const res = { setHeader: vi.fn() };
  mw({ headers: {}, ip, socket: {}, body } as never, res as never, next);
  return { err: next.mock.calls[0]?.[0], res };
}

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows up to max then 429s", () => {
    const mw = rateLimit({ name: "t", max: 3, windowSeconds: 60 });
    expect(call(mw, "1.1.1.1").err).toBeUndefined();
    expect(call(mw, "1.1.1.1").err).toBeUndefined();
    expect(call(mw, "1.1.1.1").err).toBeUndefined();
    const blocked = call(mw, "1.1.1.1");
    expect(blocked.err.statusCode).toBe(429);
  });

  it("sets Retry-After so a client knows when to come back", () => {
    const mw = rateLimit({ name: "t", max: 1, windowSeconds: 60 });
    call(mw, "1.1.1.1");
    const blocked = call(mw, "1.1.1.1");
    expect(blocked.res.setHeader).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });

  it("buckets separately per IP — one attacker cannot lock out everyone", () => {
    const mw = rateLimit({ name: "t", max: 1, windowSeconds: 60 });
    call(mw, "1.1.1.1");
    expect(call(mw, "1.1.1.1").err.statusCode).toBe(429);
    expect(call(mw, "2.2.2.2").err).toBeUndefined();
  });

  it("buckets separately per keyOn value (e.g. email)", () => {
    const mw = rateLimit({ name: "t", max: 1, windowSeconds: 60, keyOn: "email" });
    call(mw, "1.1.1.1", { email: "a@x.test" });
    expect(call(mw, "1.1.1.1", { email: "a@x.test" }).err.statusCode).toBe(429);
    expect(call(mw, "1.1.1.1", { email: "b@x.test" }).err).toBeUndefined();
  });

  it("treats the keyOn value case-insensitively (A@x = a@x)", () => {
    const mw = rateLimit({ name: "t", max: 1, windowSeconds: 60, keyOn: "email" });
    call(mw, "1.1.1.1", { email: "A@X.test" });
    expect(call(mw, "1.1.1.1", { email: "a@x.test" }).err.statusCode).toBe(429);
  });

  it("prefers x-forwarded-for over the socket address", () => {
    const mw = rateLimit({ name: "t", max: 1, windowSeconds: 60 });
    const next1 = vi.fn();
    const next2 = vi.fn();
    const req = (xff: string) =>
      ({ headers: { "x-forwarded-for": xff }, ip: "9.9.9.9", socket: {}, body: {} }) as never;
    mw(req("5.5.5.5"), { setHeader: vi.fn() } as never, next1);
    mw(req("5.5.5.5"), { setHeader: vi.fn() } as never, next2);
    expect(next1.mock.calls[0][0]).toBeUndefined();
    expect(next2.mock.calls[0][0].statusCode).toBe(429);
  });

  it("separate limiters do not share a bucket", () => {
    const a = rateLimit({ name: "login", max: 1, windowSeconds: 60 });
    const b = rateLimit({ name: "signup", max: 1, windowSeconds: 60 });
    call(a, "1.1.1.1");
    expect(call(a, "1.1.1.1").err.statusCode).toBe(429);
    expect(call(b, "1.1.1.1").err).toBeUndefined();
  });
});
