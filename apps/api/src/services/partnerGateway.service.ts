import { SecretProvider, SecretScope, SecretStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { listSecrets, createSecret, updateSecret, rotateSecret } from "./secretVault.service";

// Partner-owned payment gateway credentials. Unlike the PLATFORM gateway (whose
// keys live in server env), a partner can't set env, so its keys are stored in
// the PARTNER-scope Secret Vault — encrypted, and only ever surfaced as a last-4
// mask, exactly like the admin AI-keys and SMTP screens.
//
// HONESTY: storing keys here does NOT yet route a customer's live charge to the
// partner's gateway — the top-up flow still uses the platform gateway. Per-
// partner charge routing lands with commission billing (Slice 5d). The status
// exposes `liveRoutingEnabled: false` so the UI can say so plainly rather than
// implying customers are already being charged to the partner's account.

export type PartnerProvider = "razorpay" | "stripe";

const ACTIVE_CONFIG_LABEL = "Partner gateway config";
const CONFIG_SENTINEL = "config"; // vault requires a non-empty ciphertext
const LABELS: Record<PartnerProvider, string> = {
  razorpay: "Partner Razorpay secret",
  stripe: "Partner Stripe secret",
};

function ctxFor(partnerTenantId: string) {
  return { scope: SecretScope.PARTNER, tenantId: partnerTenantId } as const;
}

interface ActiveMeta {
  activeProvider?: PartnerProvider;
}
interface RazorpayMeta {
  keyIdLast4?: string;
}

async function entries(partnerTenantId: string) {
  return listSecrets(ctxFor(partnerTenantId), { provider: SecretProvider.CUSTOM, includeDisabled: true });
}

export interface PartnerGatewayStatus {
  activeProvider: PartnerProvider | null;
  liveRoutingEnabled: false; // see honesty note above
  providers: Array<{
    provider: PartnerProvider;
    configured: boolean;
    active: boolean;
    last4: string | null;
    keyIdLast4: string | null; // razorpay only
  }>;
}

export async function getPartnerGatewayStatus(partnerTenantId: string): Promise<PartnerGatewayStatus> {
  const all = await entries(partnerTenantId);
  const config = all.find((e) => e.label === ACTIVE_CONFIG_LABEL);
  const activeProvider = ((config?.metadata as ActiveMeta | null)?.activeProvider ?? null) as
    | PartnerProvider
    | null;

  const status = (provider: PartnerProvider) => {
    const row = all.find((e) => e.label === LABELS[provider] && e.status === SecretStatus.ACTIVE);
    return {
      provider,
      configured: Boolean(row),
      active: activeProvider === provider && Boolean(row),
      last4: row?.last4 ?? null,
      keyIdLast4: provider === "razorpay" ? ((row?.metadata as RazorpayMeta | null)?.keyIdLast4 ?? null) : null,
    };
  };

  return {
    activeProvider,
    liveRoutingEnabled: false,
    providers: [status("razorpay"), status("stripe")],
  };
}

export interface SaveKeysInput {
  provider: PartnerProvider;
  secret: string; // Razorpay key secret / Stripe secret key
  keyId?: string; // Razorpay key id (semi-public); ignored for Stripe
}

/** Store or rotate the partner's key for a provider. Idempotent per label. */
export async function savePartnerGatewayKeys(
  partnerTenantId: string,
  input: SaveKeysInput,
  userId?: string,
): Promise<PartnerGatewayStatus> {
  if (!input.secret.trim()) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A secret key is required.");
  }
  if (input.provider === "razorpay" && !input.keyId?.trim()) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A Razorpay key id is required.");
  }
  const ctx = ctxFor(partnerTenantId);
  const all = await entries(partnerTenantId);
  const existing = all.find((e) => e.label === LABELS[input.provider]);

  const metadata =
    input.provider === "razorpay"
      ? { keyIdLast4: (input.keyId ?? "").slice(-4) }
      : undefined;

  if (existing) {
    await rotateSecret(ctx, existing.id, input.secret);
    await updateSecret(ctx, existing.id, { status: SecretStatus.ACTIVE, metadata });
  } else {
    await createSecret(ctx, {
      provider: SecretProvider.CUSTOM,
      label: LABELS[input.provider],
      value: input.secret,
      metadata,
      createdByUserId: userId,
    });
  }
  return getPartnerGatewayStatus(partnerTenantId);
}

/** Choose which configured provider is active. Refuses an unconfigured one. */
export async function setPartnerActiveProvider(
  partnerTenantId: string,
  provider: PartnerProvider,
  userId?: string,
): Promise<PartnerGatewayStatus> {
  const ctx = ctxFor(partnerTenantId);
  const all = await entries(partnerTenantId);
  const key = all.find((e) => e.label === LABELS[provider] && e.status === SecretStatus.ACTIVE);
  if (!key) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Add your ${provider} keys before making it active.`,
    );
  }
  const config = all.find((e) => e.label === ACTIVE_CONFIG_LABEL);
  const metadata: ActiveMeta = { activeProvider: provider };
  if (config) {
    await updateSecret(ctx, config.id, { metadata, status: SecretStatus.ACTIVE });
  } else {
    await createSecret(ctx, {
      provider: SecretProvider.CUSTOM,
      label: ACTIVE_CONFIG_LABEL,
      value: CONFIG_SENTINEL,
      metadata,
      createdByUserId: userId,
    });
  }
  return getPartnerGatewayStatus(partnerTenantId);
}

/** Disconnect a provider (disable its key entry; clears active if it was active). */
export async function disconnectPartnerGateway(
  partnerTenantId: string,
  provider: PartnerProvider,
): Promise<PartnerGatewayStatus> {
  const ctx = ctxFor(partnerTenantId);
  const all = await entries(partnerTenantId);
  const key = all.find((e) => e.label === LABELS[provider]);
  if (key) await updateSecret(ctx, key.id, { status: SecretStatus.DISABLED });
  const config = all.find((e) => e.label === ACTIVE_CONFIG_LABEL);
  if (config && (config.metadata as ActiveMeta | null)?.activeProvider === provider) {
    await updateSecret(ctx, config.id, { metadata: {} });
  }
  return getPartnerGatewayStatus(partnerTenantId);
}
