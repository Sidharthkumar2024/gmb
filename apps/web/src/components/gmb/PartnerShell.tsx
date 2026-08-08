"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";

interface CommissionSummary {
  marginByCurrency: Record<string, number>;
  label: string;
}

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

function initials(name: string | null | undefined, email: string | undefined): string {
  const source = name?.trim() || email?.split("@")[0] || "P";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "P";
}

// Shell for the Partner Portal (white-label reseller). Dark green theme per the
// Partner Portal design, distinct from the purple admin console.
//
// Access is enforced twice: every /api/v1/partner route requires
// WHITE_LABEL_ADMIN server-side, and this shell redirects everyone else away.
// The client check is UX; the server check is the security boundary.

const NAV: Array<{ label: string; items: Array<{ href: string; name: string }> }> = [
  {
    label: "",
    items: [
      { href: "/partner", name: "Dashboard" },
      { href: "/partner/customers", name: "Customers" },
      { href: "/partner/branding", name: "Branding" },
      { href: "/partner/plans", name: "Plans & pricing" },
      { href: "/partner/commissions", name: "Commissions" },
      { href: "/partner/transactions", name: "Transactions" },
      { href: "/partner/invoices", name: "Invoices" },
      { href: "/partner/gateway", name: "Payment gateways" },
      { href: "/partner/smtp", name: "SMTP & email" },
      { href: "/partner/team", name: "Team & roles" },
      { href: "/partner/google", name: "Google API" },
      { href: "/partner/support", name: "Tickets" },
      { href: "/partner/email-templates", name: "Email templates" },
      { href: "/partner/reports", name: "Reports" },
      { href: "/partner/audit", name: "Audit logs" },
      { href: "/partner/security", name: "Security" },
    ],
  },
];

export function PartnerShell({ title, children }: { title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Real month-to-date commission for the sidebar card, from the statement.
  const [commission, setCommission] = useState<CommissionSummary | null>(null);
  const [customDomain, setCustomDomain] = useState<string | null>(null);
  useEffect(() => {
    if (!mounted || loading || user?.role !== "WHITE_LABEL_ADMIN") return;
    void Promise.all([
      api.get<{ totals: { marginByCurrency: Record<string, number> }; period: { label: string } }>(
        "/api/v1/partner/statement",
      ).catch(() => null),
      api.get<{ customDomain: string | null }>("/api/v1/partner/branding").catch(() => null),
    ]).then(([statement, branding]) => {
      setCommission(statement ? { marginByCurrency: statement.totals.marginByCurrency, label: statement.period.label } : null);
      setCustomDomain(branding?.customDomain ?? null);
    });
  }, [mounted, loading, user]);

  useEffect(() => {
    if (!mounted || loading) return;
    if (!user) {
      router.replace("/login");
    } else if (user.role !== "WHITE_LABEL_ADMIN") {
      // Signed in but not a partner — send them to their own home rather than
      // an error page that advertises the portal.
      router.replace(user.role === "SUPER_ADMIN" ? "/admin" : "/gmb-dashboard");
    }
  }, [mounted, loading, user, router]);

  if (!mounted || loading || !user || user.role !== "WHITE_LABEL_ADMIN") {
    return (
      <div className="flex h-screen items-center justify-center bg-ptn-bg font-geist text-ptn-muted">
        <span className="font-geist-mono text-xs">checking access…</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-ptn-bg font-geist text-ptn-ink">
      <aside className="flex w-[236px] flex-shrink-0 flex-col border-r border-ptn-line bg-ptn-panel">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-ptn-accent font-newsreader text-[17px] font-semibold text-ptn-bg">
            a
          </div>
          <div>
            <div className="font-newsreader text-[18px] font-medium leading-none tracking-[-0.015em]">Adgrowly</div>
            <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-ptn-subtle">
              Partner portal
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-3 pb-3">
          {NAV.map((section) => (
            <div key={section.label}>
              {section.label ? (
                <div className="px-2.5 pb-[7px] font-geist-mono text-micro uppercase tracking-[0.1em] text-ptn-subtle">
                  {section.label}
                </div>
              ) : null}
              <div className="flex flex-col gap-px">
                {section.items.map((item) => {
                  const active =
                    item.href === "/partner" ? pathname === "/partner" : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-[9px] px-2.5 py-[7px] text-[13px] no-underline hover:no-underline ${
                        active
                          ? "bg-ptn-accent/15 font-semibold text-ptn-accent"
                          : "font-medium text-ptn-muted hover:bg-ptn-panel-hover hover:text-ptn-ink"
                      }`}
                    >
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="m-3 rounded-[12px] border border-ptn-line bg-ptn-panel-hover px-3.5 py-3">
          <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-ptn-subtle">
            Margin · {commission?.label ?? "this month"}
          </div>
          {commission ? (
            (() => {
              const entries = Object.entries(commission.marginByCurrency);
              return (
                <>
                  <div className="mt-1 text-[15px] font-bold text-ptn-ink">
                    {entries.length === 0
                      ? "—"
                      : entries.map(([c, m]) => money(m, c)).join(" · ")}
                  </div>
                  <Link href="/partner/commissions" className="mt-0.5 block text-[11px] text-ptn-accent no-underline hover:underline">
                    View commissions →
                  </Link>
                </>
              );
            })()
          ) : (
            <div className="mt-1 text-[15px] font-bold text-ptn-muted">—</div>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-shrink-0 items-center gap-3.5 border-b border-ptn-line bg-ptn-bg px-7">
          <h1 className="m-0 flex-shrink-0 font-newsreader text-[24px] font-medium tracking-[-0.015em]">{title}</h1>
          <div className="flex-1" />
          <span className="rounded-full border border-ptn-line px-3 py-1.5 font-geist-mono text-micro text-ptn-muted">
            {customDomain ?? "Domain not set"}
          </span>
          {pathname === "/partner" || pathname === "/partner/customers" ? (
            <Link
              href="/partner/customers?new=1"
              className="rounded-control bg-ptn-accent px-4 py-2 text-sm2 font-semibold text-ptn-bg no-underline hover:bg-ptn-accent-hover hover:no-underline"
            >
              + New customer
            </Link>
          ) : null}
          <button
            type="button"
            title={`Sign out ${user.email}`}
            aria-label="Sign out"
            onClick={() => {
              void signOut();
              router.push("/login");
            }}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#174b31] text-xs font-semibold text-ptn-accent hover:bg-[#205c3d]"
          >
            {initials(user.name, user.email)}
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-7 pb-10 pt-6">{children}</div>
      </main>
    </div>
  );
}

// Dark-green primitives for partner screens.

export function PtnCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-ptn-line bg-ptn-panel p-5 ${className}`}>{children}</div>
  );
}

export function PtnLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-ptn-subtle">
      {children}
    </div>
  );
}

export function PtnPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger";
}) {
  const map = {
    neutral: "bg-white/[0.06] text-ptn-muted",
    ok: "bg-ptn-accent/15 text-ptn-accent",
    warn: "bg-gmb-warn/15 text-[#f0b264]",
    danger: "bg-gmb-danger/15 text-ptn-danger",
  } as const;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-tiny font-semibold ${map[tone]}`}>{children}</span>
  );
}
