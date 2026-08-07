// Boot-time environment validation. A misconfigured PRODUCTION deploy should
// fail loudly at startup — with a single consolidated list of what's wrong —
// rather than booting and throwing an opaque 500 on the first request that
// needs a missing secret (a weak JWT_SECRET, an unset encryption key, no DB).
// In development/test the same problems are reported as warnings so the dev
// fallbacks and the test suite keep running.

export interface EnvIssue {
  key: string;
  problem: string;
}

// Values copied straight from .env.example: if they survive into a real deploy
// the operator never replaced them, which is as dangerous as leaving them unset.
const PLACEHOLDER_PREFIXES = ["your_", "change_me", "changeme"];

function secretIssue(env: NodeJS.ProcessEnv, key: string, minLength = 16): EnvIssue | null {
  const raw = env[key];
  if (!raw) return { key, problem: "not set" };
  if (PLACEHOLDER_PREFIXES.some((p) => raw.toLowerCase().startsWith(p))) {
    return { key, problem: "still the .env.example placeholder — set a real, strong value" };
  }
  if (raw.length < minLength) {
    return { key, problem: `too short (needs >= ${minLength} characters)` };
  }
  return null;
}

/**
 * Pure: gather every configuration problem so the caller can report them all at
 * once. `fatal` = the app cannot run correctly; `warnings` = the app runs but a
 * feature is disabled.
 */
export function collectEnvIssues(env: NodeJS.ProcessEnv = process.env): {
  fatal: EnvIssue[];
  warnings: string[];
} {
  const fatal: EnvIssue[] = [];
  const warnings: string[] = [];

  // Always required to run correctly.
  if (!env.DATABASE_URL) fatal.push({ key: "DATABASE_URL", problem: "not set" });
  const jwt = secretIssue(env, "JWT_SECRET");
  if (jwt) fatal.push(jwt);
  const kek = secretIssue(env, "TENANT_TOKEN_ENCRYPTION_KEY");
  if (kek) fatal.push(kek);

  // Required only when background workers run — the queue needs Redis.
  if ((env.ENABLE_WORKERS ?? "").toLowerCase() === "true" && !env.REDIS_URL) {
    fatal.push({
      key: "REDIS_URL",
      problem: "required when ENABLE_WORKERS=true (BullMQ needs Redis)",
    });
  }

  // Degraded-capability warnings — the app boots, but the named feature is off.
  const razorpay = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
  const stripe = Boolean(env.STRIPE_SECRET_KEY);
  if (!razorpay && !stripe) {
    warnings.push("No payment gateway configured — wallet top-up will return 503.");
  }
  if (!env.GOOGLE_CLIENT_ID && !env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID) {
    warnings.push("Google OAuth client not set — customers cannot connect Google Business Profile.");
  }
  if (!env.SMTP_HOST) {
    warnings.push("SMTP not configured — auth/invite/receipt emails will be skipped.");
  }
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) {
    warnings.push("No AI provider key — AI features degrade to templates.");
  }

  return { fatal, warnings };
}

type Logger = Pick<Console, "warn" | "error" | "log">;

/**
 * Validate the environment at startup. Fatal problems abort the process in
 * production (exit 1); in development/test they are logged as warnings so the
 * dev fallbacks (and the test suite) still work. `exit`/`logger` are injectable
 * for testing.
 */
export function validateEnvOrExit(
  opts: { exit?: (code: number) => void; logger?: Logger } = {},
): void {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const logger = opts.logger ?? console;
  const { fatal, warnings } = collectEnvIssues();

  for (const w of warnings) logger.warn(`[env] ${w}`);

  if (fatal.length === 0) {
    logger.log(`[env] configuration OK${warnings.length ? ` (${warnings.length} optional warning(s))` : ""}`);
    return;
  }

  const nodeEnv = process.env.NODE_ENV;
  const isProd = nodeEnv !== "development" && nodeEnv !== "test";
  const detail = fatal.map((f) => `  - ${f.key}: ${f.problem}`).join("\n");
  const message =
    `Refusing to start — ${fatal.length} critical environment problem(s):\n${detail}\n` +
    "Set them in the environment (see .env.example) and restart.";

  if (isProd) {
    logger.error(`[env] ${message}`);
    exit(1);
  } else {
    logger.warn(`[env] ${message}\n(dev/test: continuing on fallbacks)`);
  }
}
