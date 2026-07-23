"use client";

import { useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Billing — read-only credits balance, per-feature pricing, and spend history.
//
// Deliberately NOT a checkout. This build has no payment ledger: the wallet is
// balance-only, so it cannot safely take money (a retried charge would
// double-bill, and a debit can't be reversed). Rather than ship a "Buy credits"
// button that can't be trusted, the page shows what you have and where it goes,
// and says plainly that top-up isn't enabled yet. When a WalletTransaction
// ledger exists, add purchase here.

interface Wallet {
  primaryWallet: {
    balanceCredits: number;
    reservedCredits: number;
    availableCredits: number;
  } | null;
}
interface CreditCost {
  feature: string;
  label: string;
  credits: number;
}
interface Usage {
  totalCalls: number;
  totalCostInCents: number;
  byFeature: Array<{ feature: string; calls: number; costInCents: number }>;
  recent: Array<{ id: string; feature: string; model: string; costInCents: number; createdAt: string }>;
}
interface Plan {
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: "MONTH" | "YEAR";
  monthlyCredits: number;
  maxLocations: number | null;
  maxKeywords: number | null;
  maxUsers: number | null;
  features: string[];
  locationsUsed: number;
}

function limit(n: number | null): string {
  return n == null ? "Unlimited" : n.toLocaleString();
}

function featureLabel(feature: string): string {
  return feature.replace(/^gmb_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function GmbBillingPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [costs, setCosts] = useState<CreditCost[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [w, c, u, p] = await Promise.all([
          api.get<Wallet>("/api/v1/customer/wallets"),
          api.get<CreditCost[]>("/api/v1/gmb/credit-costs").catch(() => []),
          api.get<Usage>("/api/v1/customer/ai-usage").catch(() => null),
          api.get<Plan | null>("/api/v1/customer/plan").catch(() => null),
        ]);
        if (cancelled) return;
        setWallet(w);
        setCosts(c);
        setUsage(u);
        setPlan(p);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiClientError ? e.message : "Could not load billing.");
      }
    }
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  const balance = wallet?.primaryWallet;
  // If every feature is priced at 0 credits, charging is off on the platform.
  const chargingOn = (costs ?? []).some((c) => c.credits > 0);

  return (
    <GmbShell title="Billing">
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Balance hero */}
      <div className="mb-3.5 grid gap-3.5 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-panel bg-gradient-to-br from-gmb-night to-gmb-night-deep p-6 text-white">
          <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-gmb-brand-border">
            AI credit balance
          </div>
          {wallet === null ? (
            <Skeleton className="mt-2 h-10 w-32" />
          ) : (
            <>
              <div className="mt-1 text-[42px] font-bold leading-none tracking-[-0.025em]">
                {balance ? balance.availableCredits.toLocaleString() : "—"}
              </div>
              <div className="mt-2 text-sm2 text-white/70">
                {balance && balance.reservedCredits > 0
                  ? `${balance.balanceCredits.toLocaleString()} total · ${balance.reservedCredits.toLocaleString()} reserved`
                  : "credits available for AI features"}
              </div>
            </>
          )}
          <div className="mt-4">
            {/* Honest, not a dead button: top-up isn't wired, and we say so. */}
            <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-control bg-white/10 px-4 py-2 text-sm2 font-semibold text-white/60">
              Top-up coming soon
            </span>
          </div>
        </div>

        <Card>
          <SectionLabel>How billing works</SectionLabel>
          <p className="mt-2 text-sm2 leading-relaxed text-gmb-ink-muted">
            AI features — review replies, post captions, images, the advisor — each spend credits.
            Everything else (syncing, tracking, reports) is free.
          </p>
          <p className="mt-2 text-sm2 leading-relaxed text-gmb-ink-muted">
            {chargingOn
              ? "Credits are deducted only after a feature runs successfully."
              : "Credit charging is currently off on this platform — AI features run without spending credits."}
          </p>
        </Card>
      </div>

      {/* Current plan — only shown when one is assigned; no plan means
          unlimited with billing off, which the balance card already conveys. */}
      {plan && (
        <Card className="mb-3.5">
          <div className="flex items-start justify-between">
            <div>
              <SectionLabel>Your plan</SectionLabel>
              <div className="mt-1.5 flex items-baseline gap-2.5">
                <span className="text-xl font-bold tracking-[-0.01em] text-gmb-ink">{plan.name}</span>
                <span className="text-sm2 text-gmb-ink-muted">
                  {plan.priceCents === 0
                    ? "Free"
                    : `${new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency }).format(plan.priceCents / 100)} / ${plan.interval === "MONTH" ? "month" : "year"}`}
                </span>
              </div>
              {plan.description && (
                <p className="mt-1 text-sm2 text-gmb-ink-muted">{plan.description}</p>
              )}
            </div>
            <Pill tone="neutral">{plan.monthlyCredits.toLocaleString()} credits / mo</Pill>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-control border border-gmb-line bg-gmb-canvas px-3 py-2.5">
              <div className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Locations</div>
              <div className="mt-0.5 text-sm2 font-semibold text-gmb-ink">
                {plan.locationsUsed} / {limit(plan.maxLocations)}
              </div>
            </div>
            <div className="rounded-control border border-gmb-line bg-gmb-canvas px-3 py-2.5">
              <div className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Keywords</div>
              <div className="mt-0.5 text-sm2 font-semibold text-gmb-ink">{limit(plan.maxKeywords)}</div>
            </div>
            <div className="rounded-control border border-gmb-line bg-gmb-canvas px-3 py-2.5">
              <div className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Users</div>
              <div className="mt-0.5 text-sm2 font-semibold text-gmb-ink">{limit(plan.maxUsers)}</div>
            </div>
          </div>

          {plan.features.length > 0 && (
            <ul className="mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-1.5 text-xs2 text-gmb-ink-muted">
                  <span className="text-gmb-ok">✓</span>
                  {f}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid gap-3.5 lg:grid-cols-2 lg:items-start">
        {/* Pricing */}
        <Card>
          <SectionLabel>What each feature costs</SectionLabel>
          {costs === null ? (
            <Skeleton className="mt-3 h-40" />
          ) : (
            <div className="mt-3 flex flex-col gap-1.5">
              {costs.map((c) => (
                <div
                  key={c.feature}
                  className="flex items-center justify-between border-b border-gmb-line-soft py-1.5 last:border-0"
                >
                  <span className="text-sm2 text-gmb-ink">{c.label}</span>
                  <span className="font-geist-mono text-xs2 font-semibold text-gmb-ink-muted">
                    {c.credits === 0 ? "free" : `${c.credits} credit${c.credits === 1 ? "" : "s"}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Where credits went */}
        <Card>
          <SectionLabel>Where your credits went</SectionLabel>
          {usage === null ? (
            <div className="mt-3 text-sm2 text-gmb-ink-muted">No AI usage recorded yet.</div>
          ) : usage.byFeature.length === 0 ? (
            <div className="mt-3 text-sm2 text-gmb-ink-muted">
              No AI features have been used yet — nothing spent.
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-col gap-2.5">
                {usage.byFeature.map((f) => {
                  const share = usage.totalCostInCents > 0 ? f.costInCents / usage.totalCostInCents : 0;
                  return (
                    <div key={f.feature}>
                      <div className="flex items-center justify-between text-xs2">
                        <span className="text-gmb-ink">{featureLabel(f.feature)}</span>
                        <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                          {f.calls} call{f.calls === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gmb-line-soft">
                        <div
                          className="h-full rounded-full bg-gmb-brand"
                          style={{ width: `${Math.round(share * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 border-t border-gmb-line-soft pt-2 font-geist-mono text-micro text-gmb-ink-subtle">
                {usage.totalCalls} AI call{usage.totalCalls === 1 ? "" : "s"} recorded
              </div>
            </>
          )}
        </Card>

        {/* Recent activity */}
        {usage && usage.recent.length > 0 && (
          <Card className="lg:col-span-2">
            <SectionLabel>Recent AI activity</SectionLabel>
            <div className="mt-3 flex flex-col">
              {usage.recent.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between border-b border-gmb-line-soft py-2 text-sm2 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <Pill tone="brand">{featureLabel(r.feature)}</Pill>
                    <span className="font-geist-mono text-micro text-gmb-ink-subtle">{r.model}</span>
                  </div>
                  <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </GmbShell>
  );
}
