import { afterEach, describe, expect, it, vi } from "vitest";

// Email must degrade honestly: with nothing configured, sends are SKIPPED (never
// silently reported as sent) and the admin test reports ok:false. The admin
// vault entry wins over env; env is the fallback.

const deps = vi.hoisted(() => ({
  listSecrets: vi.fn(),
  resolveSecretValue: vi.fn(),
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("./secretVault.service", () => ({
  listSecrets: deps.listSecrets,
  resolveSecretValue: deps.resolveSecretValue,
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: deps.createTransport },
}));

import {
  resolveSmtpSettings,
  sendEmail,
  sendTestEmail,
  SMTP_NO_AUTH_SENTINEL,
  SMTP_VAULT_LABEL,
} from "./email.service";

const VAULT_ENTRY = {
  id: "smtp-1",
  label: SMTP_VAULT_LABEL,
  metadata: { host: "smtp.mailer.com", port: 587, user: "apikey", fromEmail: "hi@acme.com", fromName: "Acme" },
};

function clearEnvSmtp() {
  for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_FROM_NAME"]) {
    vi.stubEnv(k, "");
  }
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("resolveSmtpSettings", () => {
  it("prefers the admin vault entry over env", async () => {
    deps.listSecrets.mockResolvedValue([VAULT_ENTRY]);
    deps.resolveSecretValue.mockResolvedValue("super-secret-pw");
    vi.stubEnv("SMTP_HOST", "env-host.example.com");

    const s = await resolveSmtpSettings();
    expect(s).toMatchObject({
      source: "admin",
      host: "smtp.mailer.com",
      port: 587,
      secure: false, // 587 => STARTTLS, not implicit TLS
      user: "apikey",
      password: "super-secret-pw",
      fromEmail: "hi@acme.com",
    });
  });

  it("treats the no-auth sentinel as a null password", async () => {
    deps.listSecrets.mockResolvedValue([VAULT_ENTRY]);
    deps.resolveSecretValue.mockResolvedValue(SMTP_NO_AUTH_SENTINEL);
    const s = await resolveSmtpSettings();
    expect(s?.password).toBeNull();
  });

  it("falls back to env when no vault entry exists (secure implied by port 465)", async () => {
    deps.listSecrets.mockResolvedValue([]);
    vi.stubEnv("SMTP_HOST", "env-host.example.com");
    vi.stubEnv("SMTP_PORT", "465");
    const s = await resolveSmtpSettings();
    expect(s).toMatchObject({ source: "env", host: "env-host.example.com", port: 465, secure: true });
  });

  it("returns null (email off) when host is a placeholder", async () => {
    deps.listSecrets.mockResolvedValue([]);
    vi.stubEnv("SMTP_HOST", "your_smtp_host");
    expect(await resolveSmtpSettings()).toBeNull();
  });

  it("returns null (email off) when nothing is configured", async () => {
    deps.listSecrets.mockResolvedValue([]);
    clearEnvSmtp();
    expect(await resolveSmtpSettings()).toBeNull();
  });

  it("falls back to env if the vault lookup throws", async () => {
    deps.listSecrets.mockRejectedValue(new Error("vault down"));
    vi.stubEnv("SMTP_HOST", "env-host.example.com");
    const s = await resolveSmtpSettings();
    expect(s).toMatchObject({ source: "env", host: "env-host.example.com" });
  });
});

describe("sendEmail", () => {
  it("skips silently (no transport built) when email is off", async () => {
    deps.listSecrets.mockResolvedValue([]);
    clearEnvSmtp();
    await sendEmail({ to: "a@b.com", subject: "Hi", text: "yo" });
    expect(deps.createTransport).not.toHaveBeenCalled();
  });

  it("sends via the configured transport, formatting the From with the display name", async () => {
    deps.listSecrets.mockResolvedValue([VAULT_ENTRY]);
    deps.resolveSecretValue.mockResolvedValue("pw");
    deps.createTransport.mockReturnValue({ sendMail: deps.sendMail });
    await sendEmail({ to: "a@b.com", subject: "Hi", text: "yo" });
    expect(deps.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: '"Acme" <hi@acme.com>', to: "a@b.com", subject: "Hi" }),
    );
  });
});

describe("sendTestEmail", () => {
  it("reports ok:false with a null source when email is off — never a fake success", async () => {
    deps.listSecrets.mockResolvedValue([]);
    clearEnvSmtp();
    const r = await sendTestEmail("a@b.com");
    expect(r).toMatchObject({ ok: false, source: null });
    expect(deps.createTransport).not.toHaveBeenCalled();
  });

  it("reports ok:true after a successful send", async () => {
    deps.listSecrets.mockResolvedValue([VAULT_ENTRY]);
    deps.resolveSecretValue.mockResolvedValue("pw");
    deps.createTransport.mockReturnValue({ sendMail: deps.sendMail.mockResolvedValue(undefined) });
    const r = await sendTestEmail("a@b.com");
    expect(r).toMatchObject({ ok: true, source: "admin" });
  });

  it("reports ok:false with the error message when the send throws", async () => {
    deps.listSecrets.mockResolvedValue([VAULT_ENTRY]);
    deps.resolveSecretValue.mockResolvedValue("pw");
    deps.createTransport.mockReturnValue({
      sendMail: deps.sendMail.mockRejectedValue(new Error("auth failed")),
    });
    const r = await sendTestEmail("a@b.com");
    expect(r).toMatchObject({ ok: false, source: "admin", message: "auth failed" });
  });
});
