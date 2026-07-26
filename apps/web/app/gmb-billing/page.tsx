"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Billing — credit balance, per-feature pricing, top-up, and the full ledger.
//
// Top-up goes through the active payment gateway (Razorpay or Stripe): the
// wallet is credited by the gateway webhook after payment, never by the browser.
// The ledger below is the WalletTransaction source of truth, so a balance can
// always be reconciled against its rows.

interface Wallet {
  primaryWallet: {
    balanceCredits: number;
    reservedCredits: number;
    availableCredits: number;
  } | null;
}
interface TopupInfo {
  available: boolean;
  provider: "razorpay" | "stripe" | null;
  priceLabel: string | null;
}
interface LedgerRow {
  id: string;
  type: "RESERVE" | "SETTLE" | "RELEASE" | "GRANT" | "REFUND";
  deltaCredits: number;
  balanceAfter: number;
  feature: string | null;
  reason: string | null;
  createdAt: string;
}
interface TopUpOrder {
  provider: "razorpay" | "stripe";
  credits: number;
  razorpay?: { orderId: string; amountPaisa: number; currency: string; keyId: string };
  stripe?: { checkoutUrl: string; amountCents: number; currency: string };
}

const CREDIT_PACKS = [100, 500, 1000, 5000];

// Razorpay's checkout widget is loaded on demand, once.
function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    const w = window as unknown as { Razorpay?: unknown };
    if (w.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
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
  const [topup, setTopup] = useState<TopupInfo | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  const refreshWalletAndLedger = useCallback(async () => {
    const [w, l] = await Promise.all([
      api.get<Wallet>("/api/v1/customer/wallets"),
      api.get<LedgerRow[]>("/api/v1/customer/wallet-transactions").catch(() => []),
    ]);
    setWallet(w);
    setLedger(l);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [w, c, u, p, t, l] = await Promise.all([
          api.get<Wallet>("/api/v1/customer/wallets"),
          api.get<CreditCost[]>("/api/v1/gmb/credit-costs").catch(() => []),
          api.get<Usage>("/api/v1/customer/ai-usage").catch(() => null),
          api.get<Plan | null>("/api/v1/customer/plan").catch(() => null),
          api.get<TopupInfo>("/api/v1/customer/topup-info").catch(() => null),
          api.get<LedgerRow[]>("/api/v1/customer/wallet-transactions").catch(() => []),
        ]);
        if (cancelled) return;
        setWallet(w);
        setCosts(c);
        setUsage(u);
        setPlan(p);
        setTopup(t);
        setLedger(l);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiClientError ? e.message : "Could not load billing.");
      }
    }
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  // Returning from Stripe Checkout: the wallet is credited by the webhook, which
  // may land a beat after redirect, so refresh a few times before giving up.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("topup");
    if (status === "success") {
      setNotice("Payment received — your credits will appear here within a moment.");
      let tries = 0;
      const iv = window.setInterval(() => {
        void refreshWalletAndLedger();
        if (++tries >= 5) window.clearInterval(iv);
      }, 2000);
      window.history.replaceState({}, "", "/gmb-billing");
      return () => window.clearInterval(iv);
    }
    if (status === "cancelled") {
      setNotice("Top-up cancelled — no charge was made.");
      window.history.replaceState({}, "", "/gmb-billing");
    }
  }, [refreshWalletAndLedger]);

  async function buy(credits: number) {
    setBuying(true);
    setError(null);
    setNotice(null);
    try {
      const order = await api.post<TopUpOrder>("/api/v1/billing/top-up", { credits });
      if (order.provider === "stripe" && order.stripe) {
        window.location.href = order.stripe.checkoutUrl; // redirect to Stripe Checkout
        return;
      }
      if (order.provider === "razorpay" && order.razorpay) {
        const ok = await loadRazorpay();
        if (!ok) throw new Error("Could not load the payment widget. Check your connection.");
        const rzp = order.razorpay;
        const w = window as unknown as {
          Razorpay: new (o: Record<string, unknown>) => { open: () => void };
        };
        new w.Razorpay({
          key: rzp.keyId,
          order_id: rzp.orderId,
          amount: rzp.amountPaisa,
          currency: rzp.currency,
          name: "Adgrowly GMB Suite",
          description: `${credits} AI credits`,
          handler: () => {
            setNotice("Payment received — your credits will appear here within a moment.");
            // Poll for ~30s: the webhook → grantCredits round-trip can lag a few
            // seconds after checkout closes. (Simple count, not an early-exit on
            // balance change — the wallet in this closure is stale.)
            let tries = 0;
            const iv = window.setInterval(() => {
              void refreshWalletAndLedger();
              if (++tries >= 15) window.clearInterval(iv);
            }, 2000);
          },
        }).open();
      }
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not start the top-up.",
      );
    } finally {
      setBuying(false);
    }
  }

  const balance = wallet?.primaryWallet;
  // If every feature is priced at 0 credits, charging is off on the platform.
  const chargingOn = (costs ?? []).some((c) => c.credits > 0);

  return (
    <GmbShell title="Billing">
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && (
        <div className="mb-3.5 rounded-control border border-gmb-ok/30 bg-gmb-ok/10 px-3 py-2 text-sm2 text-gmb-ok">
          {notice}
        </div>
      )}

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
            {topup === null ? (
              <Skeleton className="h-9 w-40 bg-white/10" />
            ) : topup.available ? (
              <div>
                <div className="flex flex-wrap gap-2">
                  {CREDIT_PACKS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={buying}
                      onClick={() => void buy(n)}
                      className="rounded-control bg-white px-3.5 py-2 text-sm2 font-semibold text-gmb-night hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      +{n.toLocaleString()}
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-white/60">
                  {buying ? "Opening checkout…" : `Buy credits · ${topup.priceLabel} · via ${topup.provider}`}
                </div>
              </div>
            ) : (
              // Honest: no gateway configured, so no dead "buy" button.
              <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-control bg-white/10 px-4 py-2 text-sm2 font-semibold text-white/60">
                Top-up not available yet
              </span>
            )}
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

      {/* Wallet ledger — the source of truth for the balance: every grant,
          spend, reservation and refund. */}
      <Card className="mt-3.5">
        <SectionLabel>Wallet ledger</SectionLabel>
        {ledger === null ? (
          <Skeleton className="mt-3 h-32" />
        ) : ledger.length === 0 ? (
          <div className="mt-3 text-sm2 text-gmb-ink-muted">
            No transactions yet. Top-ups, grants and spends appear here.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-gmb-line">
                  {["When", "Type", "Detail", "Change", "Balance"].map((h) => (
                    <th
                      key={h}
                      className="py-2 pr-4 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-gmb-ink-subtle"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id} className="border-b border-gmb-line-soft last:border-0">
                    <td className="whitespace-nowrap py-2 pr-4 font-geist-mono text-micro text-gmb-ink-subtle">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">
                      <Pill tone={r.type === "GRANT" || r.type === "REFUND" ? "ok" : "neutral"}>
                        {r.type}
                      </Pill>
                    </td>
                    <td className="py-2 pr-4 text-xs2 text-gmb-ink-muted">
                      {r.reason ?? (r.feature ? featureLabel(r.feature) : "—")}
                    </td>
                    <td
                      className={`py-2 pr-4 font-geist-mono text-xs2 font-semibold ${
                        r.deltaCredits > 0
                          ? "text-gmb-ok"
                          : r.deltaCredits < 0
                            ? "text-gmb-ink"
                            : "text-gmb-ink-subtle"
                      }`}
                    >
                      {r.deltaCredits > 0 ? `+${r.deltaCredits}` : r.deltaCredits}
                    </td>
                    <td className="py-2 font-geist-mono text-xs2 text-gmb-ink-muted">
                      {r.balanceAfter.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </GmbShell>
  );
}
