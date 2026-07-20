import nodemailer, { type Transporter } from "nodemailer";

// Outbound email for the standalone GMB app.
//
// The monorepo's email.service is ~400 lines spanning multiple providers plus
// per-tenant verified sender domains (smtpConfig.service / emailDomain.service,
// neither of which was carried over). GMB uses email for exactly one thing —
// rank-alert notifications — so this is plain SMTP with a platform sender.
//
// Like the AI gateway, this degrades rather than crashes: with no SMTP host
// configured it logs and returns. gmbRankAlert already treats a send failure as
// non-fatal, and a missed alert must never take down the ranking worker.

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

let transporter: Transporter | null = null;

function smtpConfigured(): boolean {
  const host = process.env.SMTP_HOST;
  return Boolean(host && !host.startsWith("your_"));
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT ?? 587);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: port === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
  });
  return transporter;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!smtpConfigured()) {
    console.warn(
      `[email] SMTP not configured — skipping "${payload.subject}" to ${payload.to}`,
    );
    return;
  }

  const from =
    process.env.SMTP_FROM ??
    `"${process.env.SMTP_FROM_NAME ?? "Adgrowly"}" <${process.env.SMTP_USER ?? "no-reply@localhost"}>`;

  await getTransporter().sendMail({
    from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    attachments: payload.attachments,
  });
}
