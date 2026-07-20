import {
  prisma,
  AiProviderKey,
  AiProviderKind,
  AiProviderStatus,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { type SecretContext, safeParseMetadata } from "./secretVault.service";

// =====================================================================
// AI Provider Hub service (Complete Planning PDF §2.10 / Phase 4).
//
// A scoped registry of AI providers + models with a fallback order.
// Scope + owning tenant are derived from the caller (reusing the vault's
// deriveSecretContext), so PLATFORM / PARTNER / CUSTOMER provider configs
// stay isolated. A config may point at an encrypted key in the Secret
// Vault (secretId); that pointer is validated within the same scope so a
// config can only reference a secret it owns.
//
// This slice ships the registry + fallback-chain resolution. Cost-manager
// aggregation (AiUsage) and live fallback execution wired into ai.service
// follow in later slices.
// =====================================================================

export {
  type SecretContext as ProviderContext,
  deriveSecretContext as deriveProviderContext,
} from "./secretVault.service";

export interface SafeProviderConfig {
  id: string;
  scope: string;
  tenantId: string | null;
  provider: AiProviderKey;
  kind: AiProviderKind;
  label: string;
  secretId: string | null;
  hasKey: boolean;
  defaultModel: string | null;
  models: string[];
  baseUrl: string | null;
  priority: number;
  isDefault: boolean;
  status: AiProviderStatus;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface ProviderRow {
  id: string;
  scope: string;
  tenantId: string | null;
  provider: AiProviderKey;
  kind: AiProviderKind;
  label: string;
  secretId: string | null;
  defaultModel: string | null;
  models: string[];
  baseUrl: string | null;
  priority: number;
  isDefault: boolean;
  status: AiProviderStatus;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------
// Pure helpers (unit-tested without a DB)
// ---------------------------------------------------------------------

export function toSafeProviderConfig(row: ProviderRow): SafeProviderConfig {
  return {
    id: row.id,
    scope: row.scope,
    tenantId: row.tenantId,
    provider: row.provider,
    kind: row.kind,
    label: row.label,
    secretId: row.secretId,
    hasKey: Boolean(row.secretId),
    defaultModel: row.defaultModel,
    models: row.models,
    baseUrl: row.baseUrl,
    priority: row.priority,
    isDefault: row.isDefault,
    status: row.status,
    metadata: safeParseMetadata(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Order configs into a fallback chain: the default first, then by
 * ascending priority (lower = tried sooner), ties broken by oldest first.
 * DISABLED configs are dropped — they never participate in fallback.
 */
export function orderProviderChain<
  T extends {
    status: AiProviderStatus;
    isDefault: boolean;
    priority: number;
    createdAt: Date;
  },
>(configs: T[]): T[] {
  return configs
    .filter((c) => c.status === AiProviderStatus.ACTIVE)
    .slice()
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
}

// ---------------------------------------------------------------------
// DB-backed operations (always scoped to the caller's context)
// ---------------------------------------------------------------------

export interface ListProvidersFilter {
  kind?: AiProviderKind;
  includeDisabled?: boolean;
}

export async function listProviders(
  ctx: SecretContext,
  filter: ListProvidersFilter = {},
): Promise<SafeProviderConfig[]> {
  const rows = await prisma.aiProviderConfig.findMany({
    where: {
      scope: ctx.scope,
      tenantId: ctx.tenantId,
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.includeDisabled ? {} : { status: AiProviderStatus.ACTIVE }),
    },
    orderBy: [{ kind: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toSafeProviderConfig);
}

/** Verify a secretId (if given) belongs to the caller's scope/tenant. */
async function assertSecretOwned(
  ctx: SecretContext,
  secretId: string | null | undefined,
): Promise<void> {
  if (!secretId) return;
  const secret = await prisma.secretVaultEntry.findFirst({
    where: { id: secretId, scope: ctx.scope, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!secret) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Referenced secret was not found in your vault scope.",
    );
  }
}

export interface CreateProviderInput {
  provider: AiProviderKey;
  kind?: AiProviderKind;
  label: string;
  secretId?: string | null;
  defaultModel?: string | null;
  models?: string[];
  baseUrl?: string | null;
  priority?: number;
  isDefault?: boolean;
  metadata?: unknown;
  createdByUserId?: string;
}

export async function createProvider(
  ctx: SecretContext,
  input: CreateProviderInput,
): Promise<SafeProviderConfig> {
  const label = input.label.trim();
  if (!label) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A label is required.");
  }
  const kind = input.kind ?? AiProviderKind.TEXT;
  await assertSecretOwned(ctx, input.secretId);

  const clash = await prisma.aiProviderConfig.findFirst({
    where: {
      scope: ctx.scope,
      tenantId: ctx.tenantId,
      provider: input.provider,
      kind,
      label,
    },
    select: { id: true },
  });
  if (clash) {
    throw new ApiError(
      ErrorCodes.CONFLICT,
      409,
      `A ${input.provider} (${kind}) provider named "${label}" already exists.`,
    );
  }

  const row = await prisma.aiProviderConfig.create({
    data: {
      scope: ctx.scope,
      tenantId: ctx.tenantId,
      provider: input.provider,
      kind,
      label,
      secretId: input.secretId ?? null,
      defaultModel: input.defaultModel ?? null,
      models: input.models ?? [],
      baseUrl: input.baseUrl ?? null,
      priority: input.priority ?? 100,
      isDefault: input.isDefault ?? false,
      metadata:
        input.metadata == null ? null : JSON.stringify(input.metadata),
      createdByUserId: input.createdByUserId ?? null,
    },
  });

  // A brand-new default must be the only default for its scope/kind.
  if (row.isDefault) {
    await prisma.aiProviderConfig.updateMany({
      where: {
        scope: ctx.scope,
        tenantId: ctx.tenantId,
        kind,
        id: { not: row.id },
      },
      data: { isDefault: false },
    });
  }
  return toSafeProviderConfig(row);
}

async function findOwnedOrThrow(ctx: SecretContext, id: string) {
  const row = await prisma.aiProviderConfig.findFirst({
    where: { id, scope: ctx.scope, tenantId: ctx.tenantId },
  });
  if (!row) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Provider config not found.");
  }
  return row;
}

export async function getProvider(
  ctx: SecretContext,
  id: string,
): Promise<SafeProviderConfig> {
  return toSafeProviderConfig(await findOwnedOrThrow(ctx, id));
}

export interface UpdateProviderInput {
  label?: string;
  secretId?: string | null;
  defaultModel?: string | null;
  models?: string[];
  baseUrl?: string | null;
  priority?: number;
  status?: AiProviderStatus;
  metadata?: unknown;
}

export async function updateProvider(
  ctx: SecretContext,
  id: string,
  input: UpdateProviderInput,
): Promise<SafeProviderConfig> {
  await findOwnedOrThrow(ctx, id);
  if (input.secretId !== undefined) {
    await assertSecretOwned(ctx, input.secretId);
  }
  const row = await prisma.aiProviderConfig.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.secretId !== undefined ? { secretId: input.secretId } : {}),
      ...(input.defaultModel !== undefined
        ? { defaultModel: input.defaultModel }
        : {}),
      ...(input.models !== undefined ? { models: input.models } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.metadata !== undefined
        ? {
            metadata:
              input.metadata == null ? null : JSON.stringify(input.metadata),
          }
        : {}),
    },
  });
  return toSafeProviderConfig(row);
}

export async function setDefaultProvider(
  ctx: SecretContext,
  id: string,
): Promise<SafeProviderConfig> {
  const target = await findOwnedOrThrow(ctx, id);
  const [, updated] = await prisma.$transaction([
    prisma.aiProviderConfig.updateMany({
      where: {
        scope: ctx.scope,
        tenantId: ctx.tenantId,
        kind: target.kind,
        id: { not: id },
      },
      data: { isDefault: false },
    }),
    prisma.aiProviderConfig.update({
      where: { id },
      data: { isDefault: true, status: AiProviderStatus.ACTIVE },
    }),
  ]);
  return toSafeProviderConfig(updated);
}

export async function deleteProvider(
  ctx: SecretContext,
  id: string,
): Promise<void> {
  await findOwnedOrThrow(ctx, id);
  await prisma.aiProviderConfig.delete({ where: { id } });
}

export interface ProviderChainEntry {
  id: string;
  provider: AiProviderKey;
  kind: AiProviderKind;
  defaultModel: string | null;
  baseUrl: string | null;
  secretId: string | null;
  hasKey: boolean;
}

/**
 * Resolve the ordered fallback chain for a scope + kind. Consumers walk
 * the list, trying each provider until one succeeds.
 */
export async function resolveProviderChain(
  ctx: SecretContext,
  kind: AiProviderKind = AiProviderKind.TEXT,
): Promise<ProviderChainEntry[]> {
  const rows = await prisma.aiProviderConfig.findMany({
    where: {
      scope: ctx.scope,
      tenantId: ctx.tenantId,
      kind,
      status: AiProviderStatus.ACTIVE,
    },
  });
  return orderProviderChain(rows).map((row) => ({
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    defaultModel: row.defaultModel,
    baseUrl: row.baseUrl,
    secretId: row.secretId,
    hasKey: Boolean(row.secretId),
  }));
}
