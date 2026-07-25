import { prisma, TenantStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

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
