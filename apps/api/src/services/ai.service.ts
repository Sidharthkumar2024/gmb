import Anthropic from "@anthropic-ai/sdk";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { prisma } from "@nexaflow/db";
import { assertCanAffordAi, debitAi } from "./billing.service";

// AI gateway for the standalone GMB app.
//
// The monorepo's ai.service is ~1,500 lines covering WhatsApp copywriting,
// intent detection, segment building and knowledge-base retrieval. The GMB
// code imports exactly one function from it — runTenantLlmJson — so this is a
// focused implementation of that contract rather than a port of the rest.
//
// Every GMB caller already degrades gracefully when AI is unavailable (falling
// back to template copy), so the "not configured" path must throw a clean
// ApiError rather than crash: that is what those fallbacks catch.

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022";

// USD per token, for the AiUsage cost ledger — Claude 3.5 Sonnet.
const INPUT_USD_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 15 / 1_000_000;

export interface CallLlmOpts {
  tenantId: string;
  feature: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

let client: Anthropic | null = null;

/** A key that is absent or still a placeholder counts as not configured. */
export function hasConfiguredAiClient(): boolean {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return Boolean(
    apiKey && !apiKey.startsWith("your_") && apiKey !== "sk-ant-placeholder",
  );
}

function getClient(): Anthropic {
  if (client) return client;
  if (!hasConfiguredAiClient()) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "ANTHROPIC_API_KEY is not configured. Set a real key in the API .env to enable AI features.",
    );
  }
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return client;
}

/**
 * Claude is asked for JSON but may wrap it in prose or a code fence, so slice
 * between the outermost braces rather than trusting the whole response.
 */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      "AI provider returned non-JSON output.",
    );
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      502,
      "AI provider returned malformed JSON.",
    );
  }
}

/**
 * Run a tenant-billed LLM call that must return JSON.
 *
 * Affordability is checked BEFORE the call; usage and the credit debit are
 * written after it succeeds, so a provider failure never bills the customer.
 * Ledger failures are logged, not thrown — losing an audit row must not lose
 * the caller's result.
 */
export async function runTenantLlmJson<T>(opts: CallLlmOpts): Promise<T> {
  const anthropic = getClient();
  await assertCanAffordAi(opts.tenantId, opts.feature);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature ?? 0.4,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  const raw = textBlock?.type === "text" ? textBlock.text : "";
  const parsed = extractJson(raw) as T;

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costInCents = Math.ceil(
    (inputTokens * INPUT_USD_PER_TOKEN + outputTokens * OUTPUT_USD_PER_TOKEN) * 100,
  );

  try {
    const usage = await prisma.aiUsage.create({
      data: {
        tenantId: opts.tenantId,
        model: MODEL,
        feature: opts.feature,
        inputTokens,
        outputTokens,
        costInCents,
      },
    });
    await debitAi(opts.tenantId, {
      aiUsageId: usage.id,
      feature: opts.feature,
      reason: `AI call (${opts.feature})`,
    });
  } catch (err) {
    console.error("[ai] failed to log usage/debit", err);
  }

  return parsed;
}
