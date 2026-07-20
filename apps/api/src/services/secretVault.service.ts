import {
  prisma,
  SecretProvider,
  SecretScope,
  SecretStatus,
} from "@nexaflow/db";
import { ApiError, ErrorCodes, UserRole } from "@nexaflow/shared";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";

// =====================================================================
// API Secret Vault service (Complete Planning PDF §2.9, §5).
//
// Stores provider credentials envelope-encrypted at rest. The vault is
// scoped: SuperAdmin manages PLATFORM secrets (tenantId null), a
// white-label partner manages its own PARTNER secrets, and a customer
// manages its own CUSTOMER secrets. The scope + owning tenantId are
// always DERIVED from the authenticated caller — never taken from the
// request body — so one scope can never read or mutate another's keys.
//
// Ciphertext never leaves the server via list endpoints; callers get a
// masked `last4` plus non-secret metadata. Reveal / rotate / test are
// audited at the route layer.
// =====================================================================

/** The owning context for a vault operation, derived from the caller. */
export interface SecretContext {
  scope: SecretScope;
  tenantId: string | null;
}

/** Safe, ciphertext-free view returned to clients. */
export interface SafeSecret {
  id: string;
  scope: SecretScope;
  tenantId: string | null;
  provider: SecretProvider;
  label: string;
  last4: string | null;
  metadata: unknown;
  status: SecretStatus;
  lastRotatedAt: Date | null;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Structural shape of the fields we read off a SecretVaultEntry row. */
interface SecretRow {
  id: string;
  scope: SecretScope;
  tenantId: string | null;
  provider: SecretProvider;
  label: string;
  last4: string | null;
  metadata: string | null;
  status: SecretStatus;
  lastRotatedAt: Date | null;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------
// Pure helpers (unit-tested without a DB)
// ---------------------------------------------------------------------

/**
 * Derive the vault scope + owning tenant from the authenticated caller.
 * SuperAdmin → PLATFORM (no tenant). Partner → PARTNER. Customer →
 * CUSTOMER. Any other role is rejected.
 */
export function deriveSecretContext(
  role: UserRole | undefined,
  tenantId: string | null | undefined,
): SecretContext {
  switch (role) {
    case UserRole.SUPER_ADMIN:
      return { scope: SecretScope.PLATFORM, tenantId: null };
    case UserRole.WHITE_LABEL_ADMIN:
      if (!tenantId) {
        throw new ApiError(
          ErrorCodes.FORBIDDEN,
          403,
          "Partner context required for the secret vault.",
        );
      }
      return { scope: SecretScope.PARTNER, tenantId };
    case UserRole.BUSINESS_ADMIN:
      if (!tenantId) {
        throw new ApiError(
          ErrorCodes.FORBIDDEN,
          403,
          "Customer context required for the secret vault.",
        );
      }
      return { scope: SecretScope.CUSTOMER, tenantId };
    default:
      throw new ApiError(
        ErrorCodes.FORBIDDEN,
        403,
        "This role may not access the secret vault.",
      );
  }
}

/** Last 4 visible characters of a secret, for masked display. */
export function captureLast4(plaintext: string): string | null {
  const trimmed = plaintext.trim();
  if (!trimmed) return null;
  return trimmed.slice(-4);
}

/** Defensive JSON parse for the non-secret metadata blob. */
export function safeParseMetadata(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Map a row to the safe, ciphertext-free DTO. */
export function toSafeSecret(row: SecretRow): SafeSecret {
  return {
    id: row.id,
    scope: row.scope,
    tenantId: row.tenantId,
    provider: row.provider,
    label: row.label,
    last4: row.last4,
    metadata: safeParseMetadata(row.metadata),
    status: row.status,
    lastRotatedAt: row.lastRotatedAt,
    lastTestedAt: row.lastTestedAt,
    lastTestOk: row.lastTestOk,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (always scoped to the caller's SecretContext)
// ---------------------------------------------------------------------

export interface ListSecretsFilter {
  provider?: SecretProvider;
  includeDisabled?: boolean;
}

export async function listSecrets(
  ctx: SecretContext,
  filter: ListSecretsFilter = {},
): Promise<SafeSecret[]> {
  const rows = await prisma.secretVaultEntry.findMany({
    where: {
      scope: ctx.scope,
      tenantId: ctx.tenantId,
      ...(filter.provider ? { provider: filter.provider } : {}),
      ...(filter.includeDisabled ? {} : { status: SecretStatus.ACTIVE }),
    },
    orderBy: [{ provider: "asc" }, { label: "asc" }],
  });
  return rows.map(toSafeSecret);
}

export interface CreateSecretInput {
  provider: SecretProvider;
  label: string;
  value: string;
  metadata?: unknown;
  createdByUserId?: string;
}

export async function createSecret(
  ctx: SecretContext,
  input: CreateSecretInput,
): Promise<SafeSecret> {
  const label = input.label.trim();
  if (!label) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A label is required.");
  }
  if (!input.value.trim()) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "A secret value is required.",
    );
  }

  // No duplicate active label for the same scope/tenant/provider.
  const clash = await prisma.secretVaultEntry.findFirst({
    where: {
      scope: ctx.scope,
      tenantId: ctx.tenantId,
      provider: input.provider,
      label,
      status: SecretStatus.ACTIVE,
    },
    select: { id: true },
  });
  if (clash) {
    throw new ApiError(
      ErrorCodes.CONFLICT,
      409,
      `A ${input.provider} secret named "${label}" already exists.`,
    );
  }

  const row = await prisma.secretVaultEntry.create({
    data: {
      scope: ctx.scope,
      tenantId: ctx.tenantId,
      provider: input.provider,
      label,
      ciphertext: encryptToken(input.value),
      last4: captureLast4(input.value),
      metadata:
        input.metadata == null ? null : JSON.stringify(input.metadata),
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeSecret(row);
}

async function findOwnedOrThrow(ctx: SecretContext, id: string) {
  const row = await prisma.secretVaultEntry.findFirst({
    where: { id, scope: ctx.scope, tenantId: ctx.tenantId },
  });
  if (!row) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Secret not found.");
  }
  return row;
}

export async function getSecret(
  ctx: SecretContext,
  id: string,
): Promise<SafeSecret> {
  return toSafeSecret(await findOwnedOrThrow(ctx, id));
}

export interface UpdateSecretInput {
  label?: string;
  metadata?: unknown;
  status?: SecretStatus;
}

export async function updateSecret(
  ctx: SecretContext,
  id: string,
  input: UpdateSecretInput,
): Promise<SafeSecret> {
  await findOwnedOrThrow(ctx, id);
  const row = await prisma.secretVaultEntry.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.metadata !== undefined
        ? {
            metadata:
              input.metadata == null ? null : JSON.stringify(input.metadata),
          }
        : {}),
    },
  });
  return toSafeSecret(row);
}

export async function rotateSecret(
  ctx: SecretContext,
  id: string,
  newValue: string,
): Promise<SafeSecret> {
  await findOwnedOrThrow(ctx, id);
  if (!newValue.trim()) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "A new secret value is required.",
    );
  }
  const row = await prisma.secretVaultEntry.update({
    where: { id },
    data: {
      ciphertext: encryptToken(newValue),
      last4: captureLast4(newValue),
      lastRotatedAt: new Date(),
    },
  });
  return toSafeSecret(row);
}

/**
 * Decrypt and return the plaintext secret. Server-internal / explicit
 * reveal only; the route layer gates this behind permission + audit.
 */
export async function revealSecret(
  ctx: SecretContext,
  id: string,
): Promise<{ id: string; provider: SecretProvider; label: string; value: string }> {
  const row = await findOwnedOrThrow(ctx, id);
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    value: decryptToken(row.ciphertext),
  };
}

/**
 * Internal, scoped, NON-audited decryption for service-to-service use
 * (e.g. the AI gateway pulling a provider key). Returns null when the
 * secret is missing, disabled, or out of the caller's scope. Never call
 * this from a route that returns the value to the client — use
 * revealSecret (audited) for that.
 */
export async function resolveSecretValue(
  ctx: SecretContext,
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;
  const row = await prisma.secretVaultEntry.findFirst({
    where: {
      id,
      scope: ctx.scope,
      tenantId: ctx.tenantId,
      status: SecretStatus.ACTIVE,
    },
    select: { ciphertext: true },
  });
  if (!row) return null;
  return decryptToken(row.ciphertext);
}

export interface TestSecretResult {
  ok: boolean;
  message: string;
}

/**
 * Connectivity test for a stored secret. For now this validates that the
 * stored material decrypts cleanly and is non-empty, and records the
 * outcome; live per-provider pings (OpenAI /models, Razorpay, SMTP login,
 * etc.) plug in here in a later slice.
 */
export async function testSecret(
  ctx: SecretContext,
  id: string,
): Promise<TestSecretResult> {
  const row = await findOwnedOrThrow(ctx, id);
  let ok = false;
  let message = "";
  try {
    const value = decryptToken(row.ciphertext);
    ok = value.trim().length > 0;
    message = ok
      ? "Secret decrypts and is present. Live provider check pending."
      : "Stored secret is empty.";
  } catch {
    ok = false;
    message = "Stored secret could not be decrypted.";
  }
  await prisma.secretVaultEntry.update({
    where: { id },
    data: { lastTestedAt: new Date(), lastTestOk: ok },
  });
  return { ok, message };
}

export async function deleteSecret(
  ctx: SecretContext,
  id: string,
): Promise<void> {
  await findOwnedOrThrow(ctx, id);
  await prisma.secretVaultEntry.delete({ where: { id } });
}
