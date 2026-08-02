import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publicObjectUrl,
  putPublicObject,
  readPublicObjectStorageConfig,
  resolvePublicObjectStorageConfig,
  setPublicObjectStorageResolver,
  type PublicObjectStorageConfig,
} from "./publicObjectStorage";

// Public (unauthenticated) asset hosting for Google-fetched media: the config
// must be a credential-free HTTPS delivery URL, object keys are constrained to
// a safe charset (no traversal / absolute paths), and puts go out with a long
// immutable cache header.

const CONFIG: PublicObjectStorageConfig = {
  bucket: "assets",
  region: "us-east-1",
  publicBaseUrl: "https://cdn.example.com",
  forcePathStyle: false,
};

afterEach(() => setPublicObjectStorageResolver(null));

describe("readPublicObjectStorageConfig", () => {
  const base = { S3_BUCKET_NAME: "assets", S3_PUBLIC_BASE_URL: "https://cdn.example.com/" };

  it("reads a minimal valid env, stripping the trailing slash and defaulting region", () => {
    const cfg = readPublicObjectStorageConfig(base as NodeJS.ProcessEnv);
    expect(cfg).toMatchObject({
      bucket: "assets",
      publicBaseUrl: "https://cdn.example.com", // trailing slash removed
      region: "us-east-1",
      forcePathStyle: false,
    });
  });

  it("throws when the bucket or public base URL is missing", () => {
    expect(() => readPublicObjectStorageConfig({ S3_PUBLIC_BASE_URL: "https://c.io" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => readPublicObjectStorageConfig({ S3_BUCKET_NAME: "b" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("rejects a non-HTTPS base URL, or one carrying credentials/query/fragment", () => {
    for (const url of [
      "http://cdn.example.com",
      "https://user:pw@cdn.example.com",
      "https://cdn.example.com/?x=1",
      "https://cdn.example.com/#frag",
      "not a url",
    ]) {
      expect(() => readPublicObjectStorageConfig({ S3_BUCKET_NAME: "b", S3_PUBLIC_BASE_URL: url } as NodeJS.ProcessEnv)).toThrow();
    }
  });

  it("defaults region to 'auto' when a custom endpoint is set, and validates it", () => {
    const cfg = readPublicObjectStorageConfig({ ...base, S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com" } as NodeJS.ProcessEnv);
    expect(cfg.region).toBe("auto");
    expect(() => readPublicObjectStorageConfig({ ...base, S3_ENDPOINT: "ftp://x" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("reads forcePathStyle from the 'true' flag", () => {
    expect(readPublicObjectStorageConfig({ ...base, S3_FORCE_PATH_STYLE: "true" } as NodeJS.ProcessEnv).forcePathStyle).toBe(true);
    expect(readPublicObjectStorageConfig({ ...base, S3_FORCE_PATH_STYLE: "no" } as NodeJS.ProcessEnv).forcePathStyle).toBe(false);
  });
});

describe("publicObjectUrl / key safety", () => {
  it("builds the URL for a valid key, preserving path separators", () => {
    expect(publicObjectUrl(CONFIG, "branding/t1/123-logo.png")).toBe(
      "https://cdn.example.com/branding/t1/123-logo.png",
    );
  });

  it("rejects unsafe keys (traversal, absolute, trailing slash, bad charset, empty)", () => {
    for (const key of ["../secret", "/abs", "trailing/", "has space", "$weird", ".", ""]) {
      expect(() => publicObjectUrl(CONFIG, key)).toThrow(/Invalid public object storage key/);
    }
  });
});

describe("resolvePublicObjectStorageConfig", () => {
  it("prefers an injected resolver over env", () => {
    const injected = { ...CONFIG, bucket: "from-resolver" };
    setPublicObjectStorageResolver(() => injected);
    expect(resolvePublicObjectStorageConfig()).toBe(injected);
  });
});

describe("putPublicObject", () => {
  it("sends a PutObject with an immutable cache header and returns the public URL", async () => {
    const send = vi.fn().mockResolvedValue({});
    const url = await putPublicObject(
      { key: "gmb-images/t1/pic.png", body: Buffer.from("data"), contentType: "image/png" },
      { config: CONFIG, client: { send } },
    );
    expect(url).toBe("https://cdn.example.com/gmb-images/t1/pic.png");
    const input = send.mock.calls[0][0].input;
    expect(input).toMatchObject({
      Bucket: "assets",
      Key: "gmb-images/t1/pic.png",
      ContentType: "image/png",
      ContentLength: 4,
      CacheControl: "public, max-age=31536000, immutable",
    });
  });

  it("honours a custom cache-control and rejects an unsafe key before sending", async () => {
    const send = vi.fn().mockResolvedValue({});
    await putPublicObject(
      { key: "a/b.png", body: Buffer.from("x"), contentType: "image/png", cacheControl: "no-store" },
      { config: CONFIG, client: { send } },
    );
    expect(send.mock.calls[0][0].input.CacheControl).toBe("no-store");

    await expect(
      putPublicObject({ key: "../evil", body: Buffer.from("x"), contentType: "image/png" }, { config: CONFIG, client: { send } }),
    ).rejects.toThrow(/Invalid public object storage key/);
    expect(send).toHaveBeenCalledOnce(); // the second call never sent
  });
});
