import Link from "next/link";
import type { ReactNode } from "react";

// Shared shell for standalone legal pages (Terms, Privacy). Themed like the
// rest of the marketing surface, centred, with the product wordmark and a link
// home — no app chrome, since these are reachable while signed out.
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-gmb-canvas px-6 py-12 font-geist">
      <div className="mx-auto max-w-[680px]">
        <Link href="/" className="inline-flex items-center gap-2 no-underline hover:no-underline">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-gmb-brand-light to-gmb-brand-lighter text-[12px] font-bold text-white">
            G
          </span>
          <span className="text-sm font-bold text-gmb-ink">GMB Suite</span>
        </Link>

        <h1 className="mt-8 text-[28px] font-bold tracking-[-0.02em] text-gmb-ink">{title}</h1>
        <div className="mt-4 flex flex-col gap-4 text-sm2 leading-relaxed text-gmb-ink-muted">
          {children}
        </div>
      </div>
    </main>
  );
}
