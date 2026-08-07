import { afterEach, describe, expect, it, vi } from "vitest";
import { collectEnvIssues, validateEnvOrExit } from "./validateEnv";

// A well-formed production-ish environment used as the baseline; individual
// tests remove/override one key to prove the check catches it.
function goodEnv(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    JWT_SECRET: "a-sufficiently-long-random-secret-value",
    TENANT_TOKEN_ENCRYPTION_KEY: "another-long-random-encryption-key",
    RAZORPAY_KEY_ID: "rzp_x",
    RAZORPAY_KEY_SECRET: "sec",
    GOOGLE_CLIENT_ID: "cid",
    SMTP_HOST: "smtp.example.com",
    ANTHROPIC_API_KEY: "sk-ant-x",
    ...over,
  } as NodeJS.ProcessEnv;
}

const key = (issues: { key: string }[]) => issues.map((i) => i.key).sort();

describe("collectEnvIssues", () => {
  it("reports no fatal issues for a fully-configured environment", () => {
    const { fatal, warnings } = collectEnvIssues(goodEnv());
    expect(fatal).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("flags missing critical secrets — and collects them ALL, not just the first", () => {
    const { fatal } = collectEnvIssues(
      goodEnv({ DATABASE_URL: undefined, JWT_SECRET: undefined, TENANT_TOKEN_ENCRYPTION_KEY: undefined }),
    );
    expect(key(fatal)).toEqual(["DATABASE_URL", "JWT_SECRET", "TENANT_TOKEN_ENCRYPTION_KEY"]);
  });

  it("rejects .env.example placeholder secrets", () => {
    const { fatal } = collectEnvIssues(
      goodEnv({ JWT_SECRET: "change_me_to_a_long_random_string", TENANT_TOKEN_ENCRYPTION_KEY: "your_key" }),
    );
    expect(key(fatal)).toEqual(["JWT_SECRET", "TENANT_TOKEN_ENCRYPTION_KEY"]);
  });

  it("rejects secrets that are too short", () => {
    const { fatal } = collectEnvIssues(goodEnv({ JWT_SECRET: "short" }));
    expect(key(fatal)).toEqual(["JWT_SECRET"]);
  });

  it("requires REDIS_URL only when workers are enabled", () => {
    expect(collectEnvIssues(goodEnv({ ENABLE_WORKERS: "false" })).fatal).toEqual([]);
    const withWorkers = collectEnvIssues(goodEnv({ ENABLE_WORKERS: "true" }));
    expect(key(withWorkers.fatal)).toEqual(["REDIS_URL"]);
    expect(collectEnvIssues(goodEnv({ ENABLE_WORKERS: "true", REDIS_URL: "redis://x" })).fatal).toEqual([]);
  });

  it("accepts the GOOGLE_BUSINESS_PROFILE_* alias for the Google client", () => {
    const { warnings } = collectEnvIssues(
      goodEnv({ GOOGLE_CLIENT_ID: undefined, GOOGLE_BUSINESS_PROFILE_CLIENT_ID: "cid" }),
    );
    expect(warnings.join(" ")).not.toContain("Google OAuth");
  });

  it("warns (not fatal) about disabled optional features", () => {
    const { fatal, warnings } = collectEnvIssues({
      DATABASE_URL: "postgresql://x",
      JWT_SECRET: "a-sufficiently-long-random-secret-value",
      TENANT_TOKEN_ENCRYPTION_KEY: "another-long-random-encryption-key",
    } as NodeJS.ProcessEnv);
    expect(fatal).toEqual([]); // still boots
    expect(warnings.join("\n")).toMatch(/payment gateway/);
    expect(warnings.join("\n")).toMatch(/Google OAuth/);
    expect(warnings.join("\n")).toMatch(/SMTP/);
    expect(warnings.join("\n")).toMatch(/AI provider/);
  });
});

describe("validateEnvOrExit", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("exits the process in production when a critical var is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", ""); // force a fatal issue
    vi.stubEnv("JWT_SECRET", "");
    const exit = vi.fn();
    const logger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    validateEnvOrExit({ exit, logger });
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("does NOT exit in development — warns and continues on fallbacks", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("JWT_SECRET", "");
    const exit = vi.fn();
    const logger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    validateEnvOrExit({ exit, logger });
    expect(exit).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
