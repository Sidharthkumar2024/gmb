import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// Customisable transactional emails. Each known email has a built-in default;
// an admin can override its subject/body per key. Overriding is opt-in
// (useCustom) so a saved-but-not-enabled edit never changes what actually
// sends — and disabling custom instantly restores the tested default, which
// matters because these are auth emails that must not break.
//
// Bodies use {{token}} placeholders substituted at send time. The known
// placeholders per template are listed so the admin UI can show them.

export interface EmailTemplateDef {
  key: string;
  name: string;
  description: string;
  placeholders: string[];
  defaultSubject: string;
  defaultBody: string;
}

// The catalogue of emails the platform actually sends. Keeping this in code
// (not the DB) means the set can't drift from what auth.routes emits, and a
// fresh install needs no seeding to work.
export const EMAIL_TEMPLATES: EmailTemplateDef[] = [
  {
    key: "EMAIL_VERIFICATION",
    name: "Email verification",
    description: "Sent on signup and when a verification email is resent.",
    placeholders: ["url"],
    defaultSubject: "Verify your email",
    defaultBody: "Welcome to Adgrowly. Verify your email: {{url}}",
  },
  {
    key: "PASSWORD_RESET",
    name: "Password reset",
    description: "Sent when a customer requests a password reset link.",
    placeholders: ["url"],
    defaultSubject: "Reset your password",
    defaultBody:
      "Reset your password: {{url}}\n\nIf you didn't request this, ignore this email.",
  },
  {
    key: "STAFF_INVITE",
    name: "Staff invite",
    description: "Sent when a partner or admin invites a team member.",
    placeholders: ["inviter", "url"],
    defaultSubject: "You've been invited to Adgrowly",
    defaultBody:
      "{{inviter}} invited you to their Adgrowly workspace.\n\nSet your password to get started: {{url}}",
  },
];

const BY_KEY = new Map(EMAIL_TEMPLATES.map((t) => [t.key, t]));

export interface SafeEmailTemplate extends EmailTemplateDef {
  subject: string; // current effective subject (custom or default)
  body: string;
  useCustom: boolean;
  updatedAt: Date | null;
}

/** List every known template merged with any stored override. */
export async function listEmailTemplates(): Promise<SafeEmailTemplate[]> {
  const rows = await prisma.emailTemplate.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return EMAIL_TEMPLATES.map((def) => {
    const row = byKey.get(def.key);
    const useCustom = row?.useCustom ?? false;
    return {
      ...def,
      subject: useCustom && row ? row.subject : def.defaultSubject,
      body: useCustom && row ? row.body : def.defaultBody,
      useCustom,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export interface UpsertTemplateInput {
  subject: string;
  body: string;
  useCustom: boolean;
  updatedByUserId?: string;
}

export async function upsertEmailTemplate(
  key: string,
  input: UpsertTemplateInput,
): Promise<SafeEmailTemplate> {
  const def = BY_KEY.get(key);
  if (!def) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Unknown email template.");
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (input.useCustom && (!subject || !body)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "A custom subject and body are required to enable a custom template.",
    );
  }
  await prisma.emailTemplate.upsert({
    where: { key },
    create: { key, subject: subject || def.defaultSubject, body: body || def.defaultBody, useCustom: input.useCustom, updatedByUserId: input.updatedByUserId ?? null },
    update: { subject: subject || def.defaultSubject, body: body || def.defaultBody, useCustom: input.useCustom, updatedByUserId: input.updatedByUserId ?? null },
  });
  return (await listEmailTemplates()).find((t) => t.key === key)!;
}

/** Substitute {{placeholder}} tokens. Unknown tokens are left as-is. */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m,
  );
}

/**
 * Resolve the effective subject/body for a known email and substitute vars.
 * Falls back to the built-in default when there's no override or useCustom is
 * off, or if the DB read fails — an auth email must send even if this table is
 * unavailable.
 */
export async function renderEmailTemplate(
  key: string,
  vars: Record<string, string>,
): Promise<{ subject: string; text: string }> {
  const def = BY_KEY.get(key);
  if (!def) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Unknown email template.");
  let subject = def.defaultSubject;
  let body = def.defaultBody;
  try {
    const row = await prisma.emailTemplate.findUnique({ where: { key } });
    if (row?.useCustom) {
      subject = row.subject;
      body = row.body;
    }
  } catch {
    // keep defaults
  }
  return { subject: render(subject, vars), text: render(body, vars) };
}
