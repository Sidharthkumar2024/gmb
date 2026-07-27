import { SecretProvider, SecretScope, SecretStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  listSecrets,
  createSecret,
  updateSecret,
  rotateSecret,
  revealSecret,
} from "./secretVault.service";

// Partner-owned payment gateway credentials. Unlike the PLATFORM gateway (whose
// keys live in server env), a partner can't set env, so its keys live in the
// PARTNER-scope Secret Vault — encrypted, only ever surfaced as a last-4 mask,
// exactly like the admin AI-keys and SMTP screens.
//
// These credentials ARE routed into live charging: when a customer of this
// partner tops up, the order is created on the partner's own gateway account and
// the partner's webhook (verified with the partner's webhook secret) credits the
// customer. See partnerCharge.service + billing.routes. A provider is only
// "ready" to route once BOTH its API keys and its webhook secret are stored.

export type PartnerProvider = "razorpay" | "stripe";

const ACTIVE_CONFIG_LABEL = "Partner gateway config";
const CONFIG_SENTINEL = "config"; // vault requires a non-empty ciphertext
const KEY_LABELS: Record<PartnerProvider, string> = {
  razorpay: "Partner Razorpay secret",
  stripe: "Partner Stripe secret",
};
const WEBHOOK_LABELS: Record<PartnerProvider, string> = {
  razorpay: "Partner Razorpay webhook",
  stripe: "Partner Stripe webhook",
};

function ctxFor(partnerTenantId: string) {
  return { scope: SecretScope.PARTNER, tenantId: partnerTenantId } as const;
}

interface ActiveMeta {
  activeProvider?: PartnerProvider;
}
interface RazorpayMeta {
  keyId?: string; // the public key id (semi-public — the browser sees it)
  keyIdLast4?: string;
}

async function entries(partnerTenantId: string) {
  return listSecrets(ctxFor(partnerTenantId), {
    provider: SecretProvider.CUSTOM,
    includeDisabled: true,
  });
}

export interface PartnerGatewayStatus {
  partnerTenantId: string; // used by the UI to build the per-partner webhook URL
  activeProvider: PartnerProvider | null;
  liveRoutingEnabled: boolean; // true once the active provider is fully ready
  providers: Array<{
    provider: PartnerProvider;
    configured: boolean; // API keys present
    webhookConfigured: boolean; // webhook secret present
    ready: boolean; // both present — safe to route live charges
    active: boolean;
    last4: string | null;
    keyIdLast4: string | null; // razorpay only
  }>;
}

export async function getPartnerGatewayStatus(
  partnerTenantId: string,
): Promise<PartnerGatewayStatus> {
  const all = await entries(partnerTenantId);
  const config = all.find((e) => e.label === ACTIVE_CONFIG_LABEL);
  const activeProvider = ((config?.metadata as ActiveMeta | null)?.activeProvider ?? null) as
    | PartnerProvider
    | null;

  const status = (provider: PartnerProvider) => {
    const key = all.find((e) => e.label === KEY_LABELS[provider] && e.status === SecretStatus.ACTIVE);
    const webhook = all.find(
      (e) => e.label === WEBHOOK_LABELS[provider] && e.status === SecretStatus.ACTIVE,
    );
    const configured = Boolean(key);
    const webhookConfigured = Boolean(webhook);
    const ready = configured && webhookConfigured;
    return {
      provider,
      configured,
      webhookConfigured,
      ready,
      active: activeProvider === provider && configured,
      last4: key?.last4 ?? null,
      keyIdLast4:
        provider === "razorpay" ? ((key?.metadata as RazorpayMeta | null)?.keyIdLast4 ?? null) : null,
    };
  };

  const providers = [status("razorpay"), status("stripe")];
  const activeReady = providers.find((p) => p.provider === activeProvider)?.ready ?? false;
  return { partnerTenantId, activeProvider, liveRoutingEnabled: activeReady, providers };
}

export interface SaveKeysInput {
  provider: PartnerProvider;
  secret: string; // Razorpay key secret / Stripe secret key
  keyId?: string; // Razorpay key id (semi-public); ignored for Stripe
  webhookSecret?: string; // optional — set/rotate the webhook signing secret
}

async function upsertEntry(
  partnerTenantId: string,
  label: string,
  value: string,
  metadata: unknown,
  userId?: string,
) {
  const ctx = ctxFor(partnerTenantId);
  const all = await entries(partnerTenantId);
  const existing = all.find((e) => e.label === label);
  if (existing) {
    await rotateSecret(ctx, existing.id, value);
    await updateSecret(ctx, existing.id, { status: SecretStatus.ACTIVE, metadata });
  } else {
    await createSecret(ctx, {
      provider: SecretProvider.CUSTOM,
      label,
      value,
      metadata,
      createdByUserId: userId,
    });
  }
}

/** Store or rotate the partner's key (and optionally webhook secret) for a provider. */
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
  const metadata =
    input.provider === "razorpay"
      ? { keyId: input.keyId!.trim(), keyIdLast4: input.keyId!.trim().slice(-4) }
      : undefined;

  await upsertEntry(partnerTenantId, KEY_LABELS[input.provider], input.secret, metadata, userId);
  if (input.webhookSecret?.trim()) {
    await upsertEntry(
      partnerTenantId,
      WEBHOOK_LABELS[input.provider],
      input.webhookSecret.trim(),
      undefined,
      userId,
    );
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
  const key = all.find((e) => e.label === KEY_LABELS[provider] && e.status === SecretStatus.ACTIVE);
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

/** Disconnect a provider (disable its key + webhook; clears active if it was). */
export async function disconnectPartnerGateway(
  partnerTenantId: string,
  provider: PartnerProvider,
): Promise<PartnerGatewayStatus> {
  const ctx = ctxFor(partnerTenantId);
  const all = await entries(partnerTenantId);
  for (const label of [KEY_LABELS[provider], WEBHOOK_LABELS[provider]]) {
    const row = all.find((e) => e.label === label);
    if (row) await updateSecret(ctx, row.id, { status: SecretStatus.DISABLED });
  }
  const config = all.find((e) => e.label === ACTIVE_CONFIG_LABEL);
  if (config && (config.metadata as ActiveMeta | null)?.activeProvider === provider) {
    await updateSecret(ctx, config.id, { metadata: {} });
  }
  return getPartnerGatewayStatus(partnerTenantId);
}

// --- Internal: decrypted credentials for live charge routing ----------------
// Server-only. Returns the DECRYPTED keys for the partner's active provider,
// or null when the active provider isn't fully ready. Callers use these to
// create an order on / verify a webhook from the partner's own gateway account.

export interface PartnerGatewayCreds {
  provider: PartnerProvider;
  apiSecret: string;
  keyId?: string; // razorpay
  webhookSecret: string | null;
}

export async function getActivePartnerGatewayCreds(
  partnerTenantId: string,
): Promise<PartnerGatewayCreds | null> {
  const ctx = ctxFor(partnerTenantId);
  const all = await entries(partnerTenantId);
  const config = all.find((e) => e.label === ACTIVE_CONFIG_LABEL);
  const provider = (config?.metadata as ActiveMeta | null)?.activeProvider;
  if (provider !== "razorpay" && provider !== "stripe") return null;

  const keyEntry = all.find(
    (e) => e.label === KEY_LABELS[provider] && e.status === SecretStatus.ACTIVE,
  );
  if (!keyEntry) return null;
  const apiSecret = (await revealSecret(ctx, keyEntry.id)).value;

  const webhookEntry = all.find(
    (e) => e.label === WEBHOOK_LABELS[provider] && e.status === SecretStatus.ACTIVE,
  );
  const webhookSecret = webhookEntry ? (await revealSecret(ctx, webhookEntry.id)).value : null;

  return {
    provider,
    apiSecret,
    keyId: provider === "razorpay" ? (keyEntry.metadata as RazorpayMeta | null)?.keyId : undefined,
    webhookSecret,
  };
}
