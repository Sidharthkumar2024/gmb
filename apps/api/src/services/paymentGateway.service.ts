import { SecretProvider, SecretScope } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { listSecrets, createSecret, updateSecret } from "./secretVault.service";
import { createRazorpayOrder } from "./razorpay.service";
import { createStripeCheckout, stripeConfigured, stripeCreditPriceCents } from "./stripe.service";

// Payment-gateway abstraction. Two adapters (Razorpay, Stripe); the platform
// picks one active provider. Provider KEYS live in env per provider (the safest
// place for payment secrets, and consistent with how razorpay.service already
// reads them); only the active-provider CHOICE + display pricing is stored, in a
// PLATFORM vault config entry's metadata — the same shape the SMTP config uses,
// so an admin can switch providers without a deploy.
//
// Crediting always flows through grantCredits (idempotency-keyed), so the ledger
// stays the source of truth regardless of which gateway captured the payment.

export type GatewayProvider = "razorpay" | "stripe";

const PLATFORM_CTX = { scope: SecretScope.PLATFORM, tenantId: null } as const;
const CONFIG_LABEL = "Payment gateway config";
const CONFIG_SENTINEL = "config"; // vault requires a non-empty ciphertext

interface GatewayMeta {
  activeProvider?: GatewayProvider;
}

async function findConfigEntry() {
  const entries = await listSecrets(PLATFORM_CTX, { includeDisabled: true });
  return entries.find((e) => e.label === CONFIG_LABEL) ?? null;
}

/** Env-key presence per provider — reported to the admin screen, never the key. */
export function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export async function getActiveProvider(): Promise<GatewayProvider> {
  const entry = await findConfigEntry();
  const meta = (entry?.metadata ?? {}) as GatewayMeta;
  if (meta.activeProvider === "razorpay" || meta.activeProvider === "stripe") {
    return meta.activeProvider;
  }
  // Default to whichever env is configured, preferring Razorpay (already wired).
  if (razorpayConfigured()) return "razorpay";
  if (stripeConfigured()) return "stripe";
  return "razorpay";
}

export interface GatewayStatus {
  activeProvider: GatewayProvider;
  providers: Array<{
    provider: GatewayProvider;
    configured: boolean;
    active: boolean;
    priceLabel: string;
  }>;
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
  const activeProvider = await getActiveProvider();
  const rzpPrice = Number(process.env.RAZORPAY_CREDIT_PRICE_PAISA ?? 100);
  return {
    activeProvider,
    providers: [
      {
        provider: "razorpay",
        configured: razorpayConfigured(),
        active: activeProvider === "razorpay",
        priceLabel: `₹${(rzpPrice / 100).toFixed(2)} / credit`,
      },
      {
        provider: "stripe",
        configured: stripeConfigured(),
        active: activeProvider === "stripe",
        priceLabel: `$${(stripeCreditPriceCents() / 100).toFixed(2)} / credit`,
      },
    ],
  };
}

export async function setActiveProvider(
  provider: GatewayProvider,
  updatedByUserId?: string,
): Promise<GatewayStatus> {
  // Refuse to activate a provider whose keys aren't set — otherwise top-up would
  // 503 the moment a customer tried to pay.
  const configured = provider === "razorpay" ? razorpayConfigured() : stripeConfigured();
  if (!configured) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `${provider} is not configured — set its keys in the server env before making it active.`,
    );
  }
  const entry = await findConfigEntry();
  const metadata: GatewayMeta = { activeProvider: provider };
  if (entry) {
    await updateSecret(PLATFORM_CTX, entry.id, { metadata });
  } else {
    await createSecret(PLATFORM_CTX, {
      provider: SecretProvider.CUSTOM,
      label: CONFIG_LABEL,
      value: CONFIG_SENTINEL,
      metadata,
      createdByUserId: updatedByUserId,
    });
  }
  return getGatewayStatus();
}

// Normalised order the browser needs. Exactly one of razorpay/stripe is set.
export interface TopUpOrder {
  provider: GatewayProvider;
  credits: number;
  razorpay?: { orderId: string; amountPaisa: number; currency: string; keyId: string };
  stripe?: { checkoutUrl: string; amountCents: number; currency: string };
}

/** Start a top-up with whichever gateway is active. */
export async function createTopUpOrder(args: {
  tenantId: string;
  credits: number;
}): Promise<TopUpOrder> {
  const provider = await getActiveProvider();
  if (provider === "stripe") {
    const s = await createStripeCheckout(args);
    return {
      provider,
      credits: args.credits,
      stripe: { checkoutUrl: s.checkoutUrl, amountCents: s.amountCents, currency: s.currency },
    };
  }
  const r = await createRazorpayOrder(args);
  return {
    provider,
    credits: args.credits,
    razorpay: { orderId: r.orderId, amountPaisa: r.amountPaisa, currency: r.currency, keyId: r.keyId },
  };
}
