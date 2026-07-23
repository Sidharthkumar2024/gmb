import nodemailer, { type Transporter } from "nodemailer";
import { SecretProvider, SecretScope } from "@nexaflow/db";
import { listSecrets, resolveSecretValue } from "./secretVault.service";

// Outbound email for the standalone GMB app.
//
// Settings resolve from the platform Secret Vault first (Admin → Email) with
// the env SMTP_* variables as fallback — the same precedence the AI gateway
// uses, so an admin can point email at a real relay without a deploy. The
// vault entry's metadata holds the non-secret fields (host/port/from); its
// ciphertext holds the password.
//
// Like the AI gateway, this degrades rather than crashes: with nothing
// configured it logs and returns. Callers (auth emails, rank alerts) already
// treat a send failure as non-fatal.

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  /**
   * Accepted for source compatibility with the monorepo's signature. Per-tenant
   * sender domains are not implemented here, so this is currently unused —
   * every message goes out from the platform sender.
   */
  tenantId?: string;
}

const PLATFORM_CTX = { scope: SecretScope.PLATFORM, tenantId: null } as const;

/** Fixed label of the single platform SMTP vault entry (Admin → Email). */
export const SMTP_VAULT_LABEL = "Platform SMTP";

/** Ciphertext sentinel for auth-less relays — the vault requires a non-empty value. */
export const SMTP_NO_AUTH_SENTINEL = "no-auth";

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  fromEmail: string;
  fromName: string | null;
  source: "admin" | "env";
}

interface SmtpMetadata {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string | null;
  fromEmail?: string;
  fromName?: string | null;
}

/**
 * Resolve SMTP settings: the admin-saved vault entry wins; env is fallback;
 * null means email is off. Read per send — a config change applies to the
 * very next email, and email volume here is nowhere near where that matters.
 */
export async function resolveSmtpSettings(): Promise<SmtpSettings | null> {
  try {
    const entries = await listSecrets(PLATFORM_CTX, { provider: SecretProvider.SMTP });
    const entry = entries.find((e) => e.label === SMTP_VAULT_LABEL);
    if (entry) {
      const meta = (entry.metadata ?? {}) as SmtpMetadata;
      if (meta.host) {
        const raw = await resolveSecretValue(PLATFORM_CTX, entry.id);
        const password = raw && raw !== SMTP_NO_AUTH_SENTINEL ? raw : null;
        const port = meta.port ?? 587;
        return {
          host: meta.host,
          port,
          secure: meta.secure ?? port === 465,
          user: meta.user ?? null,
          password,
          fromEmail: meta.fromEmail ?? "no-reply@localhost",
          fromName: meta.fromName ?? null,
          source: "admin",
        };
      }
    }
  } catch (err) {
    console.error("[email] vault SMTP lookup failed, trying env", err);
  }

  const host = process.env.SMTP_HOST;
  if (!host || host.startsWith("your_")) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  return {
    host,
    port,
    // 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: port === 465,
    user: process.env.SMTP_USER ?? null,
    password: process.env.SMTP_PASSWORD ?? null,
    fromEmail: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@localhost",
    fromName: process.env.SMTP_FROM_NAME ?? "Adgrowly",
    source: "env",
  };
}

function buildTransporter(s: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user && s.password ? { user: s.user, pass: s.password } : undefined,
  });
}

function formatFrom(s: SmtpSettings): string {
  return s.fromName ? `"${s.fromName}" <${s.fromEmail}>` : s.fromEmail;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const settings = await resolveSmtpSettings();
  if (!settings) {
    console.warn(
      `[email] SMTP not configured — skipping "${payload.subject}" to ${payload.to}`,
    );
    return;
  }

  await buildTransporter(settings).sendMail({
    from: formatFrom(settings),
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    attachments: payload.attachments,
  });
}

export interface SmtpTestResult {
  ok: boolean;
  message: string;
  source: "admin" | "env" | null;
}

/** Send a real test email and report the outcome honestly (never fake success). */
export async function sendTestEmail(to: string): Promise<SmtpTestResult> {
  const settings = await resolveSmtpSettings();
  if (!settings) {
    return {
      ok: false,
      message: "No SMTP settings saved and no SMTP_HOST in env — email is off.",
      source: null,
    };
  }
  try {
    await buildTransporter(settings).sendMail({
      from: formatFrom(settings),
      to,
      subject: "Adgrowly SMTP test",
      text: `This is a test email from the Adgrowly admin console.\n\nServer: ${settings.host}:${settings.port} (${settings.source} settings)`,
    });
    return {
      ok: true,
      message: `Sent via ${settings.host}:${settings.port} using ${settings.source} settings.`,
      source: settings.source,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Send failed.",
      source: settings.source,
    };
  }
}
