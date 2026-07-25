"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";

// Shell for the Partner Portal (white-label reseller). Dark green theme per the
// Partner Portal design, distinct from the purple admin console.
//
// Access is enforced twice: every /api/v1/partner route requires
// WHITE_LABEL_ADMIN server-side, and this shell redirects everyone else away.
// The client check is UX; the server check is the security boundary.

const NAV: Array<{ label: string; items: Array<{ href: string; name: string }> }> = [
  {
    label: "Business",
    items: [{ href: "/partner", name: "Dashboard" }],
  },
];

export function PartnerShell({ title, children }: { title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-ptn-accent text-[15px] font-bold text-ptn-bg">
            a
          </div>
          <div>
            <div className="text-base font-bold tracking-[-0.01em]">Adgrowly</div>
            <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-ptn-subtle">
              Partner portal
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-3 pb-3">
          {NAV.map((section) => (
            <div key={section.label}>
              <div className="px-2.5 pb-[7px] font-geist-mono text-micro uppercase tracking-[0.1em] text-ptn-subtle">
                {section.label}
              </div>
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
            Commission · this month
          </div>
          <div className="mt-1 text-[15px] font-bold text-ptn-muted">Enabled with billing</div>
          <div className="mt-0.5 text-[11px] text-ptn-subtle">
            Payouts appear once payments go live.
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-shrink-0 items-center gap-3.5 border-b border-ptn-line bg-ptn-bg px-7">
          <h1 className="m-0 flex-shrink-0 text-[21px] font-bold tracking-[-0.01em]">{title}</h1>
          <div className="flex-1" />
          <span className="font-geist-mono text-micro text-ptn-subtle">{user.email}</span>
          <button
            type="button"
            onClick={() => {
              void signOut();
              router.push("/login");
            }}
            className="rounded-control border border-ptn-line px-3 py-1.5 text-xs2 font-medium text-ptn-muted hover:bg-ptn-panel-hover"
          >
            Sign out
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
