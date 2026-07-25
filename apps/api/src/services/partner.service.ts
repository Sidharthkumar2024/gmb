import { prisma, TenantStatus } from "@nexaflow/db";

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
