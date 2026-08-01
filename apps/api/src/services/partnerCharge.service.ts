import { prisma, TenantType } from "@nexaflow/db";
import {
  getActivePartnerGatewayCreds,
  type PartnerGatewayCreds,
} from "./partnerGateway.service";

// Decides, for a paying customer, whether the charge should be captured on its
// parent PARTNER's own gateway account instead of the platform's. A customer is
// routed to its partner only when: it has a parent tenant, that parent is a
// WHITE_LABEL partner, and that partner has a fully-ready active gateway (API
// keys present). Otherwise the platform gateway is used — routing is additive
// and never blocks a top-up.

export interface ResolvedPartnerGateway {
  partnerTenantId: string;
  creds: PartnerGatewayCreds;
}

/**
 * Resolve the partner gateway that should capture `payingTenantId`'s top-up, or
 * null to fall back to the platform gateway.
 */
export async function resolvePartnerGatewayForTenant(
  payingTenantId: string,
): Promise<ResolvedPartnerGateway | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: payingTenantId },
    select: { parentTenant: { select: { id: true, type: true } } },
  });
  const parent = tenant?.parentTenant;
  if (!parent || parent.type !== TenantType.WHITE_LABEL) return null;

  const creds = await getActivePartnerGatewayCreds(parent.id);
  if (!creds) return null;
  return { partnerTenantId: parent.id, creds };
}

/**
 * Resolve a partner's gateway creds by partner id — used by the per-partner
 * webhook endpoints, which learn the partner from the URL. Returns null if the
 * id isn't a WHITE_LABEL partner or has no ready gateway.
 */
export async function getPartnerGatewayById(
  partnerTenantId: string,
): Promise<PartnerGatewayCreds | null> {
  const partner = await prisma.tenant.findUnique({
    where: { id: partnerTenantId },
    select: { type: true },
  });
  if (!partner || partner.type !== TenantType.WHITE_LABEL) return null;
  return getActivePartnerGatewayCreds(partnerTenantId);
}

/**
 * Is `tenantId` a customer (child) of this partner? Used to scope a per-partner
 * webhook: the partner controls its own gateway + webhook secret, so it could
 * name any tenant in the order notes — we only ever credit its own customers.
 */
export async function isPartnerCustomer(
  partnerTenantId: string,
  tenantId: string,
): Promise<boolean> {
  const child = await prisma.tenant.findFirst({
    where: { id: tenantId, parentTenantId: partnerTenantId },
    select: { id: true },
  });
  return Boolean(child);
}
