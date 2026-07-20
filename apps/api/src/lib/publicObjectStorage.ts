import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Stable, unauthenticated object hosting for assets fetched asynchronously by
// third parties (Google Business Profile today; other channels can reuse it).
// AWS S3 and Cloudflare R2 expose the same S3-compatible PutObject API. The
// public URL is deliberately supplied separately because an R2 API endpoint is
// not a public delivery URL and presigned URLs expire.

export interface PublicObjectStorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
  /** Explicit credentials (from the super-admin DB config). When omitted, the
   *  AWS SDK default credential chain (env vars / IAM role) is used. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

// Optional resolver injected at startup by objectStorageConfig.service so the
// SuperAdmin-managed DB config is preferred over env, without this lib importing
// prisma. Falls back to the env reader when no resolver is registered.
let configResolver: (() => PublicObjectStorageConfig) | null = null;

export function setPublicObjectStorageResolver(
  fn: (() => PublicObjectStorageConfig) | null,
): void {
  configResolver = fn;
}

/** The active config: injected resolver (DB-or-env) if registered, else env. */
export function resolvePublicObjectStorageConfig(): PublicObjectStorageConfig {
  return configResolver ? configResolver() : readPublicObjectStorageConfig();
}

export interface PublicObjectSender {
  send(command: PutObjectCommand): Promise<unknown>;
}

function requiredValue(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

export function readPublicObjectStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): PublicObjectStorageConfig {
  const bucket = requiredValue(env.S3_BUCKET_NAME);
  const publicBaseUrlRaw = requiredValue(env.S3_PUBLIC_BASE_URL);
  if (!bucket || !publicBaseUrlRaw) {
    throw new Error(
      "Public object storage is not configured. Set S3_BUCKET_NAME and S3_PUBLIC_BASE_URL for GMB branded images.",
    );
  }

  let publicBaseUrl: URL;
  try {
    publicBaseUrl = new URL(publicBaseUrlRaw);
  } catch {
    throw new Error("S3_PUBLIC_BASE_URL must be a valid public HTTPS URL.");
  }
  if (publicBaseUrl.protocol !== "https:") {
    throw new Error("S3_PUBLIC_BASE_URL must use HTTPS so Google can fetch post media securely.");
  }
  if (publicBaseUrl.username || publicBaseUrl.password || publicBaseUrl.search || publicBaseUrl.hash) {
    throw new Error("S3_PUBLIC_BASE_URL must not contain credentials, a query string, or a fragment.");
  }

  const endpoint = requiredValue(env.S3_ENDPOINT) ?? undefined;
  if (endpoint) {
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(endpoint);
    } catch {
      throw new Error("S3_ENDPOINT must be a valid URL.");
    }
    if (!["http:", "https:"].includes(parsedEndpoint.protocol)) {
      throw new Error("S3_ENDPOINT must use HTTP or HTTPS.");
    }
  }

  return {
    bucket,
    region: requiredValue(env.AWS_REGION) ?? (endpoint ? "auto" : "us-east-1"),
    endpoint,
    publicBaseUrl: publicBaseUrl.toString().replace(/\/+$/, ""),
    forcePathStyle: env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === "true",
  };
}

function assertSafeObjectKey(key: string): void {
  if (
    !key ||
    key.startsWith("/") ||
    key.endsWith("/") ||
    key.includes("..") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key)
  ) {
    throw new Error("Invalid public object storage key.");
  }
}

export function publicObjectUrl(config: PublicObjectStorageConfig, key: string): string {
  assertSafeObjectKey(key);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${config.publicBaseUrl}/${encodedKey}`;
}

let cachedClient: { fingerprint: string; client: S3Client } | null = null;

function storageClient(config: PublicObjectStorageConfig): S3Client {
  const fingerprint = JSON.stringify({
    region: config.region,
    endpoint: config.endpoint ?? null,
    forcePathStyle: config.forcePathStyle,
    // Bind the client to the access key so rotating creds rebuilds it. The
    // secret is never placed in the fingerprint.
    accessKeyId: config.credentials?.accessKeyId ?? null,
  });
  if (!cachedClient || cachedClient.fingerprint !== fingerprint) {
    cachedClient = {
      fingerprint,
      client: new S3Client({
        region: config.region,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        forcePathStyle: config.forcePathStyle,
        ...(config.credentials ? { credentials: config.credentials } : {}),
      }),
    };
  }
  return cachedClient.client;
}

export async function putPublicObject(
  input: {
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl?: string;
  },
  deps: {
    config?: PublicObjectStorageConfig;
    client?: PublicObjectSender;
  } = {},
): Promise<string> {
  assertSafeObjectKey(input.key);
  const config = deps.config ?? resolvePublicObjectStorageConfig();
  const client = deps.client ?? storageClient(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.key,
      Body: input.body,
      ContentLength: input.body.length,
      ContentType: input.contentType,
      CacheControl: input.cacheControl ?? "public, max-age=31536000, immutable",
    }),
  );
  return publicObjectUrl(config, input.key);
}
