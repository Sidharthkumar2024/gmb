import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/agencies", label: "For agencies" },
];

export function MarketingShell({
  active,
  children,
}: {
  active?: "features" | "pricing" | "agencies";
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gmb-canvas font-geist text-gmb-ink">
      <header className="flex flex-wrap items-center gap-7 border-b border-gmb-line bg-gmb-surface px-6 py-[18px] lg:px-12">
        <Link href="/" className="flex items-center gap-2.5 text-gmb-ink no-underline hover:no-underline">
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-gmb-brand-light to-gmb-brand-lighter text-[13px] font-bold text-white">
            G
          </span>
          <span className="text-[17px] font-bold tracking-[-0.01em]">GMB Suite</span>
        </Link>
        <nav className="hidden gap-[22px] text-[13px] md:flex" aria-label="Marketing">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                active && item.href === `/${active}`
                  ? "font-semibold text-gmb-brand no-underline"
                  : "text-gmb-ink-muted no-underline hover:text-gmb-ink"
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <Link
          href="/login"
          className="rounded-control border border-gmb-line bg-gmb-surface px-4 py-2 text-sm2 font-medium text-gmb-ink no-underline"
        >
          Log in
        </Link>
        <Link
          href={active === "agencies" ? "/login" : "/signup"}
          className="rounded-control bg-gmb-brand px-[18px] py-2 text-sm2 font-semibold text-white no-underline hover:bg-gmb-brand-hover"
        >
          {active === "agencies" ? "Partner login" : "Start free"}
        </Link>
      </header>
      <main>{children}</main>
      <footer className="border-t border-gmb-line bg-gmb-surface px-6 pb-7 pt-12 lg:px-12">
        <div className="mx-auto max-w-[980px]">
          <div className="grid gap-8 md:grid-cols-[1.5fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-gmb-brand-light to-gmb-brand-lighter text-[11px] font-bold text-white">G</span>
                <span className="text-sm font-bold">GMB Suite</span>
              </div>
              <p className="mt-2.5 max-w-[240px] text-xs leading-relaxed text-gmb-ink-subtle">
                Local SEO on autopilot for businesses that would rather run the business.
              </p>
            </div>
            <div>
              <div className="font-geist-mono text-[9.5px] uppercase tracking-[0.1em] text-gmb-ink-subtle">Product</div>
              <div className="mt-3 flex flex-col gap-2 text-sm2 text-gmb-ink-muted">
                <Link href="/features">Features</Link>
                <Link href="/pricing">Pricing</Link>
                <Link href="/agencies">Partner program</Link>
              </div>
            </div>
            <div>
              <div className="font-geist-mono text-[9.5px] uppercase tracking-[0.1em] text-gmb-ink-subtle">Legal</div>
              <div className="mt-3 flex flex-col gap-2 text-sm2 text-gmb-ink-muted">
                <Link href="/privacy">Privacy</Link>
                <Link href="/terms">Terms</Link>
                <Link href="/login">Customer login</Link>
              </div>
            </div>
          </div>
          <div className="mt-9 flex flex-wrap items-center justify-between gap-2 border-t border-gmb-line-soft pt-5 text-xs2 text-gmb-ink-subtle">
            <span>© 2026 Adgrowly</span>
            <span>Built on Google Business Profile APIs</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
