import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  listSecrets: vi.fn(),
  resolveSecretValue: vi.fn(),
  createSecret: vi.fn(),
  updateSecret: vi.fn(),
  rotateSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock("./secretVault.service", () => ({
  listSecrets: deps.listSecrets,
  resolveSecretValue: deps.resolveSecretValue,
  createSecret: deps.createSecret,
  updateSecret: deps.updateSecret,
  rotateSecret: deps.rotateSecret,
  deleteSecret: deps.deleteSecret,
}));

import { buildUploadKey, getStorageConfig, presignUpload, saveStorageConfig } from "./storage.service";

const META = {
  provider: "S3" as const,
  bucket: "my-bucket",
  region: "us-east-1",
  endpoint: null,
  publicBaseUrl: null,
  accessKeyId: "AKIAEXAMPLE1234",
  hasSecretKey: true,
};
const ENTRY = { id: "sec-1", label: "Object storage", last4: "1234", metadata: META };
const AT = new Date("2026-01-02T03:04:05Z");

beforeEach(() => vi.clearAllMocks());

describe("buildUploadKey", () => {
  const T = "tenant-9";

  it("maps purpose to a prefix and scopes the key to the tenant", () => {
    expect(buildUploadKey({ purpose: "branding-logo", tenantId: T, filename: "logo.png", now: AT }))
      .toBe(`branding/${T}/${AT.getTime()}-logo.png`);
    expect(buildUploadKey({ purpose: "gmb-image", tenantId: T, filename: "shop.jpg", now: AT }))
      .toBe(`gmb-images/${T}/${AT.getTime()}-shop.jpg`);
  });

  it("neutralises path traversal — no separators survive into the key segment", () => {
    const key = buildUploadKey({ purpose: "gmb-image", tenantId: T, filename: "../../etc/passwd", now: AT });
    // Exactly the prefix + tenant + one filename segment: no extra "/" from the name.
    expect(key.split("/")).toHaveLength(3);
    expect(key).toBe(`gmb-images/${T}/${AT.getTime()}-.._.._etc_passwd`);
  });

  it("collapses spaces and other unsafe characters to underscores", () => {
    const key = buildUploadKey({ purpose: "branding-logo", tenantId: T, filename: "my logo (v2)!.png", now: AT });
    expect(key).toBe(`branding/${T}/${AT.getTime()}-my_logo__v2__.png`);
  });

  it("falls back to 'file' for empty or dot-only names", () => {
    for (const filename of ["", ".", ".."]) {
      expect(buildUploadKey({ purpose: "gmb-image", tenantId: T, filename, now: AT }))
        .toBe(`gmb-images/${T}/${AT.getTime()}-file`);
    }
  });

  it("caps the filename to its last 100 characters", () => {
    const long = "a".repeat(150) + ".png";
    const key = buildUploadKey({ purpose: "gmb-image", tenantId: T, filename: long, now: AT });
    const seg = key.split("/")[2].replace(`${AT.getTime()}-`, "");
    expect(seg).toHaveLength(100);
    expect(seg.endsWith(".png")).toBe(true);
  });
});

describe("getStorageConfig", () => {
  it("reports not configured when no entry exists", async () => {
    deps.listSecrets.mockResolvedValue([]);
    expect(await getStorageConfig()).toEqual({ configured: false });
  });

  it("masks the keys and never leaks the full access key id", async () => {
    deps.listSecrets.mockResolvedValue([ENTRY]);
    const cfg = await getStorageConfig();
    expect(cfg).toMatchObject({
      configured: true,
      bucket: "my-bucket",
      accessKeyIdLast4: "1234",
      secretKeyLast4: "1234",
    });
    expect(JSON.stringify(cfg)).not.toContain("AKIAEXAMPLE1234");
  });
});

describe("presignUpload", () => {
  it("throws 503 when storage isn't configured", async () => {
    deps.listSecrets.mockResolvedValue([]);
    await expect(presignUpload({ key: "a/b.png" })).rejects.toMatchObject({ statusCode: 503 });
  });

  it("produces a deterministic, well-formed SigV4 PUT URL", async () => {
    deps.listSecrets.mockResolvedValue([ENTRY]);
    deps.resolveSecretValue.mockResolvedValue("secretkey");
    const a = await presignUpload({ key: "logos/acme.png", expiresSeconds: 600, now: AT });
    const b = await presignUpload({ key: "logos/acme.png", expiresSeconds: 600, now: AT });
    expect(a.uploadUrl).toBe(b.uploadUrl); // same inputs → same signature
    expect(a.uploadUrl).toContain("https://my-bucket.s3.us-east-1.amazonaws.com/logos/acme.png?");
    expect(a.uploadUrl).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(a.uploadUrl).toContain(
      "X-Amz-Credential=AKIAEXAMPLE1234%2F20260102%2Fus-east-1%2Fs3%2Faws4_request",
    );
    expect(a.uploadUrl).toContain("X-Amz-Expires=600");
    expect(a.uploadUrl).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
    expect(a.publicUrl).toBe("https://my-bucket.s3.us-east-1.amazonaws.com/logos/acme.png");
  });

  it("honours a custom R2 endpoint and public base URL", async () => {
    deps.listSecrets.mockResolvedValue([
      {
        ...ENTRY,
        metadata: {
          ...META,
          provider: "R2",
          endpoint: "acct.r2.cloudflarestorage.com",
          publicBaseUrl: "https://cdn.example.com",
        },
      },
    ]);
    deps.resolveSecretValue.mockResolvedValue("secretkey");
    const r = await presignUpload({ key: "x.png", now: AT });
    expect(r.uploadUrl).toContain("https://acct.r2.cloudflarestorage.com/x.png?");
    expect(r.publicUrl).toBe("https://cdn.example.com/x.png");
  });
});

describe("saveStorageConfig", () => {
  it("requires a secret key on first save", async () => {
    deps.listSecrets.mockResolvedValue([]);
    await expect(
      saveStorageConfig({ provider: "S3", bucket: "b", region: "r", accessKeyId: "k" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("creates a vault entry with metadata and the secret on first save", async () => {
    deps.listSecrets.mockResolvedValue([]);
    await saveStorageConfig(
      { provider: "S3", bucket: "b", region: "r", accessKeyId: "k", secretAccessKey: "s" },
      "u1",
    );
    expect(deps.createSecret).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        label: "Object storage",
        value: "s",
        metadata: expect.objectContaining({ bucket: "b", hasSecretKey: true }),
      }),
    );
  });

  it("updates metadata and rotates the key when a new secret is supplied", async () => {
    deps.listSecrets.mockResolvedValue([ENTRY]);
    await saveStorageConfig(
      { provider: "S3", bucket: "b2", region: "us-east-1", accessKeyId: "k2", secretAccessKey: "s2" },
    );
    expect(deps.updateSecret).toHaveBeenCalled();
    expect(deps.rotateSecret).toHaveBeenCalledWith(expect.anything(), "sec-1", "s2");
  });
});
