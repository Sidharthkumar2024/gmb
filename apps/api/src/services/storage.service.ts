import crypto from "node:crypto";
import { SecretProvider, SecretScope } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  readPublicObjectStorageConfig,
  type PublicObjectStorageConfig,
} from "../lib/publicObjectStorage";
import {
  listSecrets,
  createSecret,
  updateSecret,
  rotateSecret,
  resolveSecretValue,
  deleteSecret,
  type SecretContext,
} from "./secretVault.service";

// Object-storage (S3 / Cloudflare R2) config + presigned uploads. Config lives
// in the PLATFORM Secret Vault exactly like SMTP and AI keys — non-secret fields
// in `metadata`, the secret access key encrypted and only ever returned as a
// last-4 mask. SDK-free: uploads use an AWS Signature V4 presigned PUT (also the
// scheme R2 speaks), so this adds no dependency.

const PLATFORM_CTX: SecretContext = { scope: SecretScope.PLATFORM, tenantId: null };
const STORAGE_VAULT_LABEL = "Object storage";

export type StorageProvider = "S3" | "R2";

export interface StorageMeta {
  provider: StorageProvider;
  bucket: string;
  region: string;
  /** Custom endpoint host (required for R2, optional for S3). No scheme. */
  endpoint?: string | null;
  /** Public base URL for reads (CDN / R2 public bucket). No trailing slash. */
  publicBaseUrl?: string | null;
  accessKeyId: string;
  hasSecretKey: boolean;
}

export type UploadPurpose = "gmb-image" | "branding-logo";

/**
 * Build the tenant-scoped object key for an upload. The tenant id is injected
 * server-side (never from the client body), so one workspace can never write
 * into another's prefix, and the filename is reduced to a single safe path
 * segment: separators and other unsafe characters collapse to "_" and the
 * length is capped, so a name like "../../etc/passwd" cannot traverse the key
 * namespace. `now` is injectable for deterministic tests.
 */
export function buildUploadKey(input: {
  purpose: UploadPurpose;
  tenantId: string;
  filename: string;
  now?: Date;
}): string {
  const prefix = input.purpose === "branding-logo" ? "branding" : "gmb-images";
  let safe = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  if (safe === "" || safe === "." || safe === "..") safe = "file";
  const ts = (input.now ?? new Date()).getTime();
  return `${prefix}/${input.tenantId}/${ts}-${safe}`;
}

async function findStorageEntry() {
  const entries = await listSecrets(PLATFORM_CTX, { provider: SecretProvider.CUSTOM });
  return entries.find((e) => e.label === STORAGE_VAULT_LABEL) ?? null;
}

/** Masked config for the admin screen — never returns the secret key. */
export async function getStorageConfig(): Promise<
  | {
      configured: true;
      provider: StorageProvider;
      bucket: string;
      region: string;
      endpoint: string | null;
      publicBaseUrl: string | null;
      accessKeyIdLast4: string;
      secretKeyLast4: string | null;
    }
  | { configured: false }
> {
  const entry = await findStorageEntry();
  if (!entry) return { configured: false };
  const meta = (entry.metadata ?? {}) as StorageMeta;
  return {
    configured: true,
    provider: meta.provider,
    bucket: meta.bucket,
    region: meta.region,
    endpoint: meta.endpoint ?? null,
    publicBaseUrl: meta.publicBaseUrl ?? null,
    accessKeyIdLast4: (meta.accessKeyId ?? "").slice(-4),
    secretKeyLast4: meta.hasSecretKey ? entry.last4 : null,
  };
}

export async function storageConfigured(): Promise<boolean> {
  const entry = await findStorageEntry();
  return Boolean(entry && (entry.metadata as StorageMeta | null)?.hasSecretKey);
}

/**
 * Full server-side S3/R2 config for SDK uploads. Unlike the masked admin view,
 * this stays inside the API process and resolves the encrypted secret only at
 * the moment an upload is performed.
 */
export async function resolvePublicStorageConfig(): Promise<PublicObjectStorageConfig> {
  const entry = await findStorageEntry();
  // Preserve environment/IAM-based deployments while preferring the encrypted
  // admin-managed vault whenever it exists.
  if (!entry) return readPublicObjectStorageConfig();
  const meta = entry?.metadata as StorageMeta | undefined;
  if (!meta?.hasSecretKey || !meta.bucket || !meta.region || !meta.accessKeyId) {
    throw new ApiError(ErrorCodes.SERVICE_UNAVAILABLE, 503, "Object storage is not configured.");
  }
  const secretAccessKey = await resolveSecretValue(PLATFORM_CTX, entry.id);
  if (!secretAccessKey) {
    throw new ApiError(ErrorCodes.SERVICE_UNAVAILABLE, 503, "Object storage secret is unavailable.");
  }
  const endpoint = meta.endpoint?.trim()
    ? /^https?:\/\//i.test(meta.endpoint)
      ? meta.endpoint
      : `https://${meta.endpoint}`
    : undefined;
  const publicBaseUrl = meta.publicBaseUrl?.trim().replace(/\/+$/, "")
    || `https://${storageHost(meta)}`;
  return {
    bucket: meta.bucket,
    region: meta.region,
    endpoint,
    publicBaseUrl,
    forcePathStyle: false,
    credentials: { accessKeyId: meta.accessKeyId, secretAccessKey },
  };
}

export interface SaveStorageInput {
  provider: StorageProvider;
  bucket: string;
  region: string;
  endpoint?: string | null;
  publicBaseUrl?: string | null;
  accessKeyId: string;
  /** Optional on update — omitted keeps the stored key. */
  secretAccessKey?: string;
}

/** Create or update the storage config, rotating the secret key when supplied. */
export async function saveStorageConfig(
  input: SaveStorageInput,
  createdByUserId?: string,
): Promise<void> {
  const existing = await findStorageEntry();
  const hasStoredSecret = Boolean((existing?.metadata as StorageMeta | null)?.hasSecretKey);
  if (!existing && !input.secretAccessKey) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "A secret access key is required.");
  }

  const metadata: StorageMeta = {
    provider: input.provider,
    bucket: input.bucket.trim(),
    region: input.region.trim(),
    endpoint: input.endpoint?.trim() || null,
    publicBaseUrl: input.publicBaseUrl?.trim().replace(/\/+$/, "") || null,
    accessKeyId: input.accessKeyId.trim(),
    hasSecretKey: input.secretAccessKey ? true : hasStoredSecret,
  };

  if (existing) {
    await updateSecret(PLATFORM_CTX, existing.id, { metadata });
    if (input.secretAccessKey) {
      await rotateSecret(PLATFORM_CTX, existing.id, input.secretAccessKey);
    }
  } else {
    await createSecret(PLATFORM_CTX, {
      provider: SecretProvider.CUSTOM,
      label: STORAGE_VAULT_LABEL,
      value: input.secretAccessKey!,
      metadata,
      createdByUserId,
    });
  }
}

/** Remove the stored storage config (disables uploads until reconfigured). */
export async function deleteStorageConfig(): Promise<void> {
  const entry = await findStorageEntry();
  if (entry) await deleteSecret(PLATFORM_CTX, entry.id);
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function storageHost(meta: StorageMeta): string {
  if (meta.endpoint) return meta.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${meta.bucket}.s3.${meta.region}.amazonaws.com`;
}

/**
 * A time-limited presigned PUT URL the browser (or server) can upload to
 * directly — AWS Signature V4 query signing, which S3 and R2 both accept.
 * Returns the upload URL and the eventual public read URL.
 */
export async function presignUpload(args: {
  key: string;
  expiresSeconds?: number;
  now?: Date; // injectable for tests
}): Promise<{ uploadUrl: string; publicUrl: string }> {
  const entry = await findStorageEntry();
  const meta = entry?.metadata as StorageMeta | undefined;
  if (!entry || !meta?.hasSecretKey) {
    throw new ApiError(ErrorCodes.SERVICE_UNAVAILABLE, 503, "Object storage is not configured.");
  }
  const secretKey = await resolveSecretValue(PLATFORM_CTX, entry.id);
  if (!secretKey) {
    throw new ApiError(ErrorCodes.SERVICE_UNAVAILABLE, 503, "Object storage secret is unavailable.");
  }

  const expires = Math.min(Math.max(args.expiresSeconds ?? 900, 1), 604800);
  const now = args.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const host = storageHost(meta);
  // Encode each path segment but keep the slashes.
  const canonicalUri =
    "/" + args.key.split("/").map((s) => encodeURIComponent(s)).join("/");
  const scope = `${dateStamp}/${meta.region}/s3/aws4_request`;

  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${meta.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  });
  // S3 requires the query to be sorted for the canonical request.
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), meta.region), "s3"),
    "aws4_request",
  );
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const uploadUrl = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  const publicUrl = publicReadUrl(meta, args.key);
  return { uploadUrl, publicUrl };
}

function publicReadUrl(meta: StorageMeta, key: string): string {
  const path = key.split("/").map((s) => encodeURIComponent(s)).join("/");
  if (meta.publicBaseUrl) return `${meta.publicBaseUrl}/${path}`;
  return `https://${storageHost(meta)}/${path}`;
}
