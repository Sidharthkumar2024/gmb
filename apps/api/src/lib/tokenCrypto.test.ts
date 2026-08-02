import { describe, expect, it } from "vitest";
import {
  decryptToken,
  decryptTokenIfNeeded,
  encryptToken,
  isEncryptedToken,
} from "./tokenCrypto";

// Envelope encryption (AES-256-GCM, per-record DEK wrapped by an HKDF'd KEK):
// it must round-trip exactly, be non-deterministic (fresh IV/DEK per call),
// carry a version tag, and REJECT any tampering via the GCM auth tag.

describe("encrypt/decrypt round-trip", () => {
  it("recovers the exact plaintext, including unicode and empty strings", () => {
    for (const s of ["hello", "", "sk-ant-abcdef123456", "clé—✓—秘密\n\t"]) {
      expect(decryptToken(encryptToken(s))).toBe(s);
    }
  });

  it("produces a versioned envelope, not the plaintext", () => {
    const env = encryptToken("secret-value");
    expect(env.startsWith("v1:")).toBe(true);
    expect(env).not.toContain("secret-value");
  });

  it("is non-deterministic — two encryptions differ but both decrypt", () => {
    const a = encryptToken("same");
    const b = encryptToken("same");
    expect(a).not.toBe(b); // random IV + DEK
    expect(decryptToken(a)).toBe("same");
    expect(decryptToken(b)).toBe("same");
  });
});

describe("isEncryptedToken", () => {
  it("recognises only the v1 envelope prefix", () => {
    expect(isEncryptedToken(encryptToken("x"))).toBe(true);
    expect(isEncryptedToken("plain")).toBe(false);
    expect(isEncryptedToken(null)).toBe(false);
    expect(isEncryptedToken(undefined)).toBe(false);
  });
});

describe("tamper resistance", () => {
  it("throws when the ciphertext is modified (GCM auth tag fails)", () => {
    const env = encryptToken("do-not-tamper");
    const blob = Buffer.from(env.slice(3), "base64");
    blob[blob.length - 1] ^= 0xff; // flip a byte in the data ciphertext/tag region
    const tampered = `v1:${blob.toString("base64")}`;
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("refuses to decrypt something that isn't an envelope", () => {
    expect(() => decryptToken("not-an-envelope")).toThrow(/not an encrypted envelope/);
  });
});

describe("decryptTokenIfNeeded", () => {
  it("passes plaintext through, decrypts envelopes, and maps empty to null", () => {
    expect(decryptTokenIfNeeded(null)).toBeNull();
    expect(decryptTokenIfNeeded("")).toBeNull();
    expect(decryptTokenIfNeeded("already-plain")).toBe("already-plain");
    expect(decryptTokenIfNeeded(encryptToken("wrapped"))).toBe("wrapped");
  });
});
