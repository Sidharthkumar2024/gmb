import { Request } from "express";
import { prisma } from "@nexaflow/db";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGIN_THROTTLED"
  | "LOGOUT"
  | "DEMO_TENANT_CREATED"
  | "DEMO_TENANT_RENEWED"
  | "DEMO_TENANT_DELETED"
  | "DEMO_TENANT_CONVERTED"
  | "DEMO_CONVERSION_RECOMMENDED"
  | "SIGNUP"
  | "PASSWORD_RESET_REQUEST"
  | "PASSWORD_RESET_COMPLETE"
  | "EMAIL_VERIFICATION_RESENT"
  | "EMAIL_VERIFIED"
  | "IMPERSONATE"
  | "RECONCILIATION_DRIFT"
  | "RUN_RECONCILIATION"
  | "LOW_BALANCE_ALERT"
  | "WALLET_AUTO_SUSPENDED"
  | "WALLET_AUTO_REACTIVATED"
  | "AGENT_DISABLED_ALERT"
  | "REPLY"
  | "ANSWER"
  | "ANNOTATE"
  | "COMPLIANCE_CHECK"
  | "COMPLIANCE_OVERRIDE"
  | "COMPLIANCE_ESCALATION_STAGE_CHANGE"
  | "COMPLIANCE_ESCALATION_SUSPEND_CONFIRMED"
  | "COMPLIANCE_ESCALATION_MANUAL_OVERRIDE"
  | "COMPLIANCE_ESCALATION_CLEARED"
  | "BILLING_PLAN_REQUEST"
  | "PROPOSAL_GENERATED"
  | "PROPOSAL_CREATED"
  | "PROPOSAL_STATUS_CHANGED"
  | "SECRET_REVEAL"
  | "TWO_FACTOR_ENABLED"
  | "TWO_FACTOR_DISABLED"
  | "TWO_FACTOR_RECOVERY_REGENERATED";

export interface AuditInput {
  tenantId: string;
  userId: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export async function logAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? null,
        oldValues: input.oldValues ? JSON.stringify(input.oldValues) : null,
        newValues: input.newValues ? JSON.stringify(input.newValues) : null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log", err);
  }
}

export function extractRequestMeta(req: Request): {
  ipAddress: string;
  userAgent: string;
} {
  const forwarded = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return {
    ipAddress: forwarded ?? req.ip ?? req.socket.remoteAddress ?? "unknown",
    userAgent: (req.headers["user-agent"] as string | undefined) ?? "unknown",
  };
}
