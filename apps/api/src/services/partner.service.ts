import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma, TenantStatus, UserRole, AuthTokenPurpose } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { issueAuthToken } from "./authToken.service";
import { sendEmail, resolveSmtpSettings } from "./email.service";
import { renderEmailTemplate } from "./emailTemplate.service";

// Partner (reseller / white-label) portal data. A partner is a tenant whose
// child tenants (Tenant.parentTenantId) are its customers. Everything here is
// derived from real records — customer counts, locations, plans. Revenue and
// commission are deliberately ABSENT: this build has no payment ledger, so a
// number there would be fabricated. They appear once billing is wired.

export interface PartnerCustomer {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  planName: string | null;
  locations: number;
  users: number;
  createdAt: Date;
}

export interface PartnerOverview {
  totals: { customers: number; active: number; locations: number };
  customers: PartnerCustomer[];
}

export async function getPartnerOverview(partnerTenantId: string): Promise<PartnerOverview> {
  const rows = await prisma.tenant.findMany({
    where: { parentTenantId: partnerTenantId },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      plan: { select: { name: true } },
      _count: { select: { gmbLocations: true, users: true } },
    },
  });

  const customers: PartnerCustomer[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    planName: t.plan?.name ?? null,
    locations: t._count.gmbLocations,
    users: t._count.users,
    createdAt: t.createdAt,
  }));

  return {
    totals: {
      customers: customers.length,
      active: customers.filter((c) => c.status === TenantStatus.ACTIVE).length,
      locations: customers.reduce((sum, c) => sum + c.locations, 0),
    },
    customers,
  };
}

// --- White-label branding ---------------------------------------------------

export interface Branding {
  brandName: string | null;
  customDomain: string | null;
  domainVerified: boolean;
  brandColorHex: string;
  logoUrl: string | null;
  hidePoweredBy: boolean;
}

const DEFAULT_BRANDING: Branding = {
  brandName: null,
  customDomain: null,
  domainVerified: false,
  brandColorHex: "#5a4af0",
  logoUrl: null,
  hidePoweredBy: false,
};

export async function getBranding(partnerTenantId: string): Promise<Branding> {
  const row = await prisma.whiteLabelConfig.findUnique({ where: { tenantId: partnerTenantId } });
  if (!row) return { ...DEFAULT_BRANDING };
  return {
    brandName: row.brandName,
    customDomain: row.customDomain,
    domainVerified: row.domainVerified,
    brandColorHex: row.brandColorHex,
    logoUrl: row.logoUrl,
    hidePoweredBy: row.hidePoweredBy,
  };
}

export interface SaveBrandingInput {
  brandName?: string | null;
  customDomain?: string | null;
  brandColorHex?: string;
  logoUrl?: string | null;
  hidePoweredBy?: boolean;
  updatedByUserId?: string;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// A bare hostname: labels of letters/digits/hyphens joined by dots, no scheme.
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export async function saveBranding(
  partnerTenantId: string,
  input: SaveBrandingInput,
): Promise<Branding> {
  const brandColorHex = input.brandColorHex?.trim();
  if (brandColorHex && !HEX_RE.test(brandColorHex)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Brand colour must be a hex value like #5a4af0.");
  }
  const customDomain = input.customDomain?.trim().toLowerCase().replace(/^https?:\/\//, "") || null;
  if (customDomain && !DOMAIN_RE.test(customDomain)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Enter a domain like app.youragency.com (no https://).");
  }

  // Changing the domain always resets verification — a new domain hasn't been
  // proven yet, so it must not inherit the old one's verified flag.
  const existing = await prisma.whiteLabelConfig.findUnique({
    where: { tenantId: partnerTenantId },
    select: { customDomain: true },
  });
  const domainChanged = existing ? existing.customDomain !== customDomain : customDomain !== null;

  const data = {
    ...(input.brandName !== undefined ? { brandName: input.brandName?.trim() || null } : {}),
    ...(input.customDomain !== undefined ? { customDomain, ...(domainChanged ? { domainVerified: false } : {}) } : {}),
    ...(brandColorHex ? { brandColorHex } : {}),
    ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl?.trim() || null } : {}),
    ...(input.hidePoweredBy !== undefined ? { hidePoweredBy: input.hidePoweredBy } : {}),
    updatedByUserId: input.updatedByUserId ?? null,
  };
  await prisma.whiteLabelConfig.upsert({
    where: { tenantId: partnerTenantId },
    create: { tenantId: partnerTenantId, ...data },
    update: data,
  });
  return getBranding(partnerTenantId);
}

// --- Team (the partner's own staff) -----------------------------------------
//
// Staff are users on the partner tenant itself (not on customer tenants).
// Roles are limited to WHITE_LABEL_ADMIN (full portal access) and AGENT.
// "Remove" deactivates + revokes sessions rather than deleting — the user row
// anchors audit history. Self-modification is blocked: you can't demote or
// remove yourself, which would strand the portal.

const STAFF_ROLES = [UserRole.WHITE_LABEL_ADMIN, UserRole.AGENT] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface StaffMember {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export async function listTeam(partnerTenantId: string): Promise<StaffMember[]> {
  const rows = await prisma.user.findMany({
    where: { tenantId: partnerTenantId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  return rows;
}

export interface InviteStaffInput {
  partnerTenantId: string;
  invitedByUserId: string;
  email: string;
  name?: string;
  role: StaffRole;
}

export interface InviteResult {
  member: StaffMember;
  /** Set-password link — also emailed; returned so the partner can share it
   * manually when platform email is off. */
  inviteUrl: string;
  emailSent: boolean;
}

export async function inviteStaff(input: InviteStaffInput): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "An email is required.");
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new ApiError(ErrorCodes.CONFLICT, 409, "A user with that email already exists.");
  }

  // The account starts with an unguessable password; the invitee sets their
  // own via the standard reset flow, so no credential ever travels by email.
  const user = await prisma.user.create({
    data: {
      tenantId: input.partnerTenantId,
      email,
      name: input.name?.trim() || null,
      password: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
      role: input.role,
    },
  });

  const { token } = await issueAuthToken(user.id, AuthTokenPurpose.PASSWORD_RESET);
  const webUrl = process.env.WEB_URL ?? "http://localhost:3000";
  const inviteUrl = `${webUrl}/reset-password?token=${token}`;

  const inviter = await prisma.user.findUnique({
    where: { id: input.invitedByUserId },
    select: { name: true, email: true },
  });

  // sendEmail silently skips when SMTP is unconfigured, so check first —
  // emailSent must mean "an email actually went out", or the partner won't
  // know to share the link themselves.
  let emailSent = false;
  try {
    if (await resolveSmtpSettings()) {
      const mail = await renderEmailTemplate("STAFF_INVITE", {
        inviter: inviter?.name ?? inviter?.email ?? "Your team",
        url: inviteUrl,
      });
      await sendEmail({ to: email, ...mail });
      emailSent = true;
    }
  } catch (err) {
    console.error("[partner] invite email failed", err);
  }

  return {
    member: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    },
    inviteUrl,
    emailSent,
  };
}

async function findStaffOrThrow(partnerTenantId: string, userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId: partnerTenantId } });
  if (!user) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Team member not found.");
  return user;
}

export async function setStaffRole(
  partnerTenantId: string,
  actingUserId: string,
  userId: string,
  role: StaffRole,
): Promise<StaffMember> {
  if (userId === actingUserId) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "You cannot change your own role.");
  }
  await findStaffOrThrow(partnerTenantId, userId);
  const user = await prisma.user.update({ where: { id: userId }, data: { role } });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export async function removeStaff(
  partnerTenantId: string,
  actingUserId: string,
  userId: string,
): Promise<void> {
  if (userId === actingUserId) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "You cannot remove your own account.");
  }
  await findStaffOrThrow(partnerTenantId, userId);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isActive: false } }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

// --- Customer Google connections --------------------------------------------
//
// Which of the partner's customers have linked Google Business Profile. Each
// customer's connection is a CUSTOMER-scope vault secret on their own tenant;
// this reads status only (never material) in two batch queries. The platform
// OAuth client itself is admin-owned and deliberately not shown here.

export interface CustomerGoogleStatus {
  tenantId: string;
  name: string;
  connected: boolean;
  accountName: string | null;
  connectedAt: string | null;
  lastSyncedAt: Date | null;
  locations: number;
}

export async function getCustomerGoogleStatus(
  partnerTenantId: string,
): Promise<CustomerGoogleStatus[]> {
  const children = await prisma.tenant.findMany({
    where: { parentTenantId: partnerTenantId },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, name: true, _count: { select: { gmbLocations: true } } },
  });
  if (children.length === 0) return [];
  const ids = children.map((c) => c.id);

  const [secrets, syncs] = await Promise.all([
    prisma.secretVaultEntry.findMany({
      where: {
        tenantId: { in: ids },
        scope: "CUSTOMER",
        provider: "GOOGLE_BUSINESS_PROFILE",
        status: "ACTIVE",
      },
      orderBy: { updatedAt: "desc" },
      select: { tenantId: true, metadata: true },
    }),
    prisma.gmbLocation.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: ids } },
      _max: { lastSyncedAt: true },
    }),
  ]);

  const secretByTenant = new Map<string, unknown>();
  for (const s of secrets) {
    // newest-first ordering means the first seen per tenant wins
    if (s.tenantId && !secretByTenant.has(s.tenantId)) {
      let meta: Record<string, unknown> = {};
      try {
        meta = s.metadata ? (JSON.parse(s.metadata) as Record<string, unknown>) : {};
      } catch {
        // metadata is display-only; a parse failure just means no extra detail
      }
      secretByTenant.set(s.tenantId, meta);
    }
  }
  const syncByTenant = new Map(syncs.map((s) => [s.tenantId, s._max.lastSyncedAt]));

  return children.map((c) => {
    const meta = secretByTenant.get(c.id) as Record<string, unknown> | undefined;
    return {
      tenantId: c.id,
      name: c.name,
      connected: secretByTenant.has(c.id),
      accountName: typeof meta?.accountName === "string" ? meta.accountName : null,
      connectedAt: typeof meta?.connectedAt === "string" ? meta.connectedAt : null,
      lastSyncedAt: syncByTenant.get(c.id) ?? null,
      locations: c._count.gmbLocations,
    };
  });
}
