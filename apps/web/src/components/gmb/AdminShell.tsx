"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";

// Shell for the SuperAdmin console (GMB Admin design — dark theme).
//
// Access is enforced twice: every /api/v1/admin route requires SUPER_ADMIN
// server-side, and this shell redirects non-admins away client-side. The
// client check is UX, the server check is the security boundary.
//
// The design mocks an email-OTP step; this build uses the same real login as
// the app (no OTP backend exists), so the shell trusts the session role
// rather than pretending a second factor happened.

const NAV: Array<{ label: string; items: Array<{ href: string; name: string }> }> = [
  {
    label: "Platform",
    items: [
      { href: "/admin", name: "Overview" },
      { href: "/admin/accounts", name: "Accounts" },
      { href: "/admin/users", name: "Users" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/google", name: "Google APIs" },
      { href: "/admin/ai", name: "AI models" },
      { href: "/admin/email", name: "Email" },
      { href: "/admin/health", name: "Health" },
      { href: "/admin/audit", name: "Audit log" },
    ],
  },
];

export function AdminShell({ title, children }: { title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || loading) return;
    if (!user) {
      router.replace("/login");
    } else if (user.role !== "SUPER_ADMIN") {
      // Signed in but not staff — send them to their own workspace, not an
      // error page that advertises the admin's existence.
      router.replace("/gmb-dashboard");
    }
  }, [mounted, loading, user, router]);

  if (!mounted || loading || !user || user.role !== "SUPER_ADMIN") {
    return (
      <div className="flex h-screen items-center justify-center bg-adm-bg font-geist text-adm-muted">
        <span className="font-geist-mono text-xs">checking access…</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-adm-bg font-geist text-adm-ink">
      {/* Sidebar */}
      <aside className="flex w-[232px] flex-shrink-0 flex-col border-r border-adm-line bg-adm-panel">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-gradient-to-br from-gmb-brand-light to-gmb-brand-lighter text-[15px] font-bold text-white">
            G
          </div>
          <span className="text-base font-bold tracking-[-0.01em]">
            GMB Suite <span className="text-gmb-brand-lighter">Admin</span>
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-3 pb-3">
          {NAV.map((section) => (
            <div key={section.label}>
              <div className="px-2.5 pb-[7px] font-geist-mono text-micro uppercase tracking-[0.1em] text-adm-subtle">
                {section.label}
              </div>
              <div className="flex flex-col gap-px">
                {section.items.map((item) => {
                  const active =
                    item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-[9px] px-2.5 py-[7px] text-[13px] no-underline hover:no-underline ${
                        active
                          ? "bg-gmb-brand/20 font-semibold text-adm-accent"
                          : "font-medium text-adm-muted hover:bg-adm-panel-hover hover:text-adm-ink"
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

        <div className="m-3 rounded-[12px] border border-adm-line bg-adm-bg px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-[11px] text-adm-subtle">
            <span className="h-1.5 w-1.5 rounded-full bg-adm-ok" />
            All actions audited
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-shrink-0 items-center gap-3.5 border-b border-adm-line bg-adm-bg px-7">
          <h1 className="m-0 flex-shrink-0 text-[21px] font-bold tracking-[-0.01em]">{title}</h1>
          <div className="flex-1" />
          <span className="font-geist-mono text-micro text-adm-subtle">{user.email}</span>
          <Link
            href="/gmb-dashboard"
            className="rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-medium text-adm-muted no-underline hover:bg-adm-panel-hover hover:no-underline"
          >
            App view
          </Link>
          <button
            type="button"
            onClick={() => {
              void signOut();
              router.push("/login");
            }}
            className="rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-medium text-adm-muted hover:bg-adm-panel-hover"
          >
            Sign out
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-7 pb-10 pt-6">{children}</div>
      </main>
    </div>
  );
}

// Dark-theme primitives for admin screens.

export function AdmCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-card border border-adm-line bg-adm-panel p-5 ${className}`}>
      {children}
    </div>
  );
}

export function AdmLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-adm-subtle">
      {children}
    </div>
  );
}

export function AdmPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "brand";
}) {
  const map = {
    neutral: "bg-white/[0.06] text-adm-muted",
    ok: "bg-adm-ok/15 text-adm-ok",
    warn: "bg-gmb-warn/15 text-[#f0b264]",
    danger: "bg-gmb-danger/15 text-[#ff8f85]",
    brand: "bg-gmb-brand/20 text-adm-accent",
  } as const;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-tiny font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}
