"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// Split auth layout from the GMB Landing design: form on the left, proof panel
// on the right.
//
// The right panel's figures are marketing copy from the design file, not live
// product metrics — they are kept verbatim and clearly attributed in the
// design, and nothing here reads from the API. Swap them for measured numbers
// before launch if you want them to be defensible.

const STATS = [
  { value: "+3.1", label: "map positions · first 90 days" },
  { value: "97%", label: "reviews replied within 24h" },
  { value: "4.9★", label: "avg customer rating" },
];

const TRUST = [
  "Google Business Profile API partner",
  "SOC 2 Type II",
  "Cancel anytime",
];

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gmb-canvas font-geist text-gmb-ink">
      <header className="flex items-center gap-7 border-b border-gmb-line bg-gmb-surface px-12 py-[18px]">
        <Link href="/" className="flex items-center gap-2.5 no-underline hover:no-underline">
          <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-gmb-brand-light to-gmb-brand-lighter text-[13px] font-bold text-white">
            G
          </div>
          <span className="text-[17px] font-bold tracking-[-0.01em] text-gmb-ink">GMB Suite</span>
          <span className="mt-[3px] font-geist-mono text-micro uppercase tracking-[0.1em] text-gmb-ink-subtle">
            by Adgrowly
          </span>
        </Link>
      </header>

      <main className="grid min-h-[calc(100vh-66px)] grid-cols-1 lg:grid-cols-[minmax(380px,1fr)_minmax(0,1.1fr)]">
        <div className="flex items-center justify-center px-8 py-10">
          <div className="w-full max-w-[380px]">
            <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-gradient-to-br from-gmb-brand-light to-gmb-brand-lighter text-xl font-bold text-white">
              G
            </div>
            <h1 className="mt-5 text-[26px] font-bold tracking-[-0.02em]">{title}</h1>
            <p className="mt-1.5 text-[13px] text-gmb-ink-muted">{subtitle}</p>
            {children}
            {footer}
            <div className="mt-6">
              <Link href="/" className="text-xs text-gmb-ink-subtle no-underline hover:underline">
                ← Back to gmb.adgrowly.com
              </Link>
            </div>
          </div>
        </div>

        <aside className="hidden flex-col justify-center gap-7 bg-gradient-to-br from-gmb-night via-[#241d3f] to-[#35286a] px-13 py-14 text-white lg:flex lg:px-[52px]">
          <div>
            <div className="max-w-[380px] text-balance text-2xl font-bold leading-[1.25] tracking-[-0.02em]">
              Businesses on GMB Suite climb 3.1 map positions in their first 90 days.
            </div>
            <div className="mt-2 text-sm2 text-[#a29fb8]">
              Median across 1,284 tracked locations, Jan–Jun 2026.
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="min-w-[120px] flex-1 rounded-[14px] border border-white/10 bg-white/[0.06] px-4 py-3.5"
              >
                <div className="text-2xl font-bold tracking-[-0.02em] text-[#b3a9ff]">{s.value}</div>
                <div className="mt-[3px] text-[11px] text-[#a29fb8]">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="rounded-card border border-white/10 bg-white/[0.06] px-5 py-[18px]">
            <div className="flex items-center gap-2.5">
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#b3a9ff] text-[13px] font-bold text-[#241d3f]">
                SR
              </span>
              <div>
                <div className="text-sm2 font-semibold">Sofia Ricci</div>
                <div className="text-[11px] text-[#a29fb8]">Casa Nonna Trattoria · Toronto</div>
              </div>
              <span className="ml-auto font-geist-mono text-[11px] text-[#e3b558]">★★★★★</span>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-[#d8d5e6]">
              &ldquo;We went from invisible to #2 for &lsquo;italian restaurant near me&rsquo; in one
              season. The AI answers our reviews better than I do — in two languages.&rdquo;
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3.5">
            {TRUST.map((t) => (
              <span key={t} className="flex items-center gap-1.5 text-[11px] text-[#a29fb8]">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#b3a9ff]/25 text-[8px] font-bold text-[#b3a9ff]">
                  ✓
                </span>
                {t}
              </span>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}

/** Labelled input matching the design's mono uppercase field label. */
export function Field({
  label,
  hint,
  right,
  ...props
}: {
  label: string;
  hint?: string;
  right?: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-geist-mono text-[9.5px] uppercase tracking-[0.1em] text-gmb-ink-subtle">
          {label}
        </span>
        {right}
      </div>
      <input
        {...props}
        className="w-full rounded-[10px] border border-gmb-line bg-gmb-subtle px-3.5 py-[11px] text-[13px] text-gmb-ink outline-none focus:border-gmb-brand"
      />
      {hint && <div className="mt-1 text-[11px] text-gmb-ink-subtle">{hint}</div>}
    </div>
  );
}

export function SubmitButton({
  children,
  disabled,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="mt-1 rounded-[10px] bg-gmb-brand px-3 py-3 text-[13.5px] font-semibold text-white shadow-[0_4px_14px_rgba(90,74,240,0.3)] transition hover:bg-gmb-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-[10px] border border-gmb-danger/25 bg-gmb-danger-bg px-3.5 py-2.5 text-[12.5px] text-gmb-danger">
      {children}
    </div>
  );
}
