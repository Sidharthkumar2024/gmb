import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync,
} from "node:crypto";

// Envelope encryption for secrets stored in the database
// (T-094 — WABA access tokens, etc.).
//
// Layout: a random per-record Data-Encryption-Key (DEK) encrypts the
// plaintext; a Master-Key (KEK) derived from TENANT_TOKEN_ENCRYPTION_KEY
// (via HKDF-SHA-256) encrypts the DEK. Both layers use AES-256-GCM with
// random 12-byte IVs and authenticated tags.
//
// On-disk format: a single base64 blob, prefixed by a version tag so we
// can rotate the algorithm without breaking existing rows.
//
//   v1:<base64( header || enc-DEK || iv-DEK || tag-DEK ||
//                iv-data || tag-data || ciphertext )>
//
// Future move: source the KEK from a KMS (`kms:rotation-id` becomes a
// new version prefix). Today the KEK lives in env; that's strictly better
// than plaintext-in-DB and is operationally compatible with a later KMS
// swap because the version prefix is opaque to callers.

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HKDF_INFO = Buffer.from("nexaflow.tenant-token.v1");

function getKek(): Buffer {
  const raw = process.env.TENANT_TOKEN_ENCRYPTION_KEY;
  if (!raw || raw.startsWith("your_") || raw.length < 16) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "TENANT_TOKEN_ENCRYPTION_KEY must be set to a strong value (>=32 bytes) in production.",
      );
    }
    // Deterministic dev fallback so encrypt/decrypt round-trip works
    // without manual setup. NEVER ship this default to prod.
    return Buffer.from(
      "DEV-ONLY-FALLBACK-KEY-DO-NOT-USE-IN-PROD-32B",
      "utf8",
    ).slice(0, KEY_LEN);
  }
  // HKDF to a fixed-length symmetric key, regardless of input length/shape.
  const derived = hkdfSync(
    "sha256",
    Buffer.from(raw, "utf8"),
    Buffer.alloc(0),
    HKDF_INFO,
    KEY_LEN,
  );
  return Buffer.from(derived);
}

export function isEncryptedToken(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}

export function encryptToken(plaintext: string): string {
  const kek = getKek();
  const dek = randomBytes(KEY_LEN);

  const ivDek = randomBytes(IV_LEN);
  const dekCipher = createCipheriv(ALGO, kek, ivDek);
  const encDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const tagDek = dekCipher.getAuthTag();

  const ivData = randomBytes(IV_LEN);
  const dataCipher = createCipheriv(ALGO, dek, ivData);
  const ciphertext = Buffer.concat([
    dataCipher.update(Buffer.from(plaintext, "utf8")),
    dataCipher.final(),
  ]);
  const tagData = dataCipher.getAuthTag();

  const blob = Buffer.concat([
    Buffer.from([KEY_LEN]), // 1-byte enc-DEK length (always 32 here)
    encDek,
    ivDek,
    tagDek,
    ivData,
    tagData,
    ciphertext,
  ]);
  return `${VERSION}:${blob.toString("base64")}`;
}

export function decryptToken(envelope: string): string {
  if (!isEncryptedToken(envelope)) {
    throw new Error("decryptToken: not an encrypted envelope");
  }
  const blob = Buffer.from(envelope.slice(VERSION.length + 1), "base64");

  let off = 0;
  const dekLen = blob[off];
  off += 1;
  const encDek = blob.subarray(off, off + dekLen);
  off += dekLen;
  const ivDek = blob.subarray(off, off + IV_LEN);
  off += IV_LEN;
  const tagDek = blob.subarray(off, off + TAG_LEN);
  off += TAG_LEN;
  const ivData = blob.subarray(off, off + IV_LEN);
  off += IV_LEN;
  const tagData = blob.subarray(off, off + TAG_LEN);
  off += TAG_LEN;
  const ciphertext = blob.subarray(off);

  const kek = getKek();
  const dekDecipher = createDecipheriv(ALGO, kek, ivDek);
  dekDecipher.setAuthTag(tagDek);
  const dek = Buffer.concat([dekDecipher.update(encDek), dekDecipher.final()]);

  const dataDecipher = createDecipheriv(ALGO, dek, ivData);
  dataDecipher.setAuthTag(tagData);
  const plain = Buffer.concat([
    dataDecipher.update(ciphertext),
    dataDecipher.final(),
  ]);
  return plain.toString("utf8");
}

/** Read-side helper: passes plaintext through, decrypts envelopes. */
export function decryptTokenIfNeeded(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return isEncryptedToken(value) ? decryptToken(value) : value;
}
