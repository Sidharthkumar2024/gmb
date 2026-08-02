"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiClientError } from "../../lib/api";

interface PublicPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: "MONTH" | "YEAR";
  monthlyCredits: number;
  maxLocations: number | null;
  maxKeywords: number | null;
  maxUsers: number | null;
  features: string[];
  isDefault: boolean;
}

const FAQS = [
  ["Do I give Adgrowly my Google password?", "No. Connection uses Google OAuth and the business.manage scope. You can revoke access from your Google account."],
  ["Will AI replies publish automatically?", "Drafts wait for approval by default. Live publishing also requires a connected Google resource; the UI distinguishes local drafts from posted replies."],
  ["Can I manage multiple locations?", "Yes, when the selected plan allows it. Plan limits shown here come directly from the active catalog managed by the platform admin."],
  ["Can I cancel anytime?", "Plan and billing terms depend on the active offer. Your Google profile remains yours, and workspace data can be exported from the product."],
];

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

const limit = (value: number | null) => value == null ? "Unlimited" : value.toLocaleString();

const isCatalogLimit = (feature: string) =>
  /\b(location|tracked keyword|monthly credit|team member|user)s?\b/i.test(feature);

export function MarketingPricing() {
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.get<PublicPlan[]>("/api/v1/public/plans", { auth: false })
      .then(setPlans)
      .catch((reason) => {
        setError(reason instanceof ApiClientError ? reason.message : "Pricing is temporarily unavailable.");
        setPlans([]);
      });
  }, []);

  return (
    <>
      <section className="px-6 py-16 text-center lg:px-12">
        <span className="font-geist-mono text-[10px] uppercase tracking-[0.12em] text-gmb-brand">Plans</span>
        <h1 className="mt-3 text-[38px] font-bold tracking-[-0.025em]">Simple pricing per location</h1>
        <p className="mx-auto mt-3 max-w-[520px] text-sm leading-relaxed text-gmb-ink-muted">
          Choose the active plan that matches your locations and workflow. Prices and limits below come from the live platform catalog.
        </p>

        {plans === null ? (
          <div className="mx-auto mt-9 grid max-w-[920px] gap-3.5 md:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-72 animate-pulse rounded-panel border border-gmb-line bg-gmb-surface" />)}
          </div>
        ) : plans.length === 0 ? (
          <div className="mx-auto mt-9 max-w-xl rounded-card border border-gmb-line bg-gmb-surface p-8">
            <h2 className="text-base font-semibold">Plan catalog unavailable</h2>
            <p className="mt-2 text-sm2 text-gmb-ink-muted">{error || "No active plans are published yet."}</p>
            <Link href="/signup" className="mt-5 inline-block rounded-control bg-gmb-brand px-5 py-2.5 text-sm2 font-semibold text-white">Create an account</Link>
          </div>
        ) : (
          <div className={`mx-auto mt-9 grid max-w-[980px] gap-3.5 ${plans.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
            {plans.map((plan) => (
              <article key={plan.id} className={`relative flex flex-col rounded-panel border bg-gmb-surface p-6 text-left ${plan.isDefault ? "border-2 border-gmb-brand shadow-[0_16px_44px_rgba(90,74,240,0.12)]" : "border-gmb-line"}`}>
                {plan.isDefault && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gmb-brand px-3 py-1 font-geist-mono text-micro font-semibold uppercase tracking-wide text-white">Recommended</span>}
                <h2 className="text-[15px] font-semibold">{plan.name}</h2>
                <p className="mt-1 min-h-10 text-xs2 leading-relaxed text-gmb-ink-muted">{plan.description || "Google Business Profile tools and plan entitlements."}</p>
                <div className="mt-5"><span className="text-[32px] font-bold tracking-[-0.03em]">{money(plan.priceCents, plan.currency)}</span><span className="text-xs text-gmb-ink-subtle">/{plan.interval === "YEAR" ? "year" : "month"}</span></div>
                <Link href={`/signup?plan=${encodeURIComponent(plan.name)}`} className={`mt-5 rounded-control px-4 py-2.5 text-center text-sm2 font-semibold no-underline ${plan.isDefault ? "bg-gmb-brand text-white" : "border border-gmb-brand-border bg-gmb-surface text-gmb-brand"}`}>Choose {plan.name}</Link>
                <div className="mt-5 flex flex-1 flex-col gap-2 border-t border-gmb-line pt-4 text-sm2">
                  <span>· {limit(plan.maxLocations)} location{plan.maxLocations === 1 ? "" : "s"}</span>
                  <span>· {limit(plan.maxKeywords)} tracked keywords</span>
                  <span>· {plan.monthlyCredits.toLocaleString()} monthly credits</span>
                  {plan.features.filter((feature) => !isCatalogLimit(feature)).map((feature) => <span key={feature}>· {feature}</span>)}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {plans && plans.length > 0 && (
        <section className="border-t border-gmb-line-soft bg-gmb-surface px-6 py-14 lg:px-12">
          <div className="mx-auto max-w-[980px] overflow-x-auto">
            <h2 className="text-center text-[26px] font-bold tracking-[-0.02em]">Compare plans in detail</h2>
            <table className="mt-8 min-w-[680px] w-full overflow-hidden rounded-card border border-gmb-line text-left text-sm2">
              <thead className="bg-gmb-subtle"><tr><th className="p-4 font-semibold">Entitlement</th>{plans.map((plan) => <th key={plan.id} className="p-4 text-center font-semibold">{plan.name}</th>)}</tr></thead>
              <tbody>
                {[
                  ["Locations", (plan: PublicPlan) => limit(plan.maxLocations)],
                  ["Tracked keywords", (plan: PublicPlan) => limit(plan.maxKeywords)],
                  ["Team members", (plan: PublicPlan) => limit(plan.maxUsers)],
                  ["Monthly credits", (plan: PublicPlan) => plan.monthlyCredits.toLocaleString()],
                ].map(([label, render]) => (
                  <tr key={label as string} className="border-t border-gmb-line">
                    <td className="p-4 font-medium">{label as string}</td>
                    {plans.map((plan) => <td key={plan.id} className="p-4 text-center text-gmb-ink-muted">{(render as (plan: PublicPlan) => string)(plan)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="px-6 py-14 lg:px-12">
        <div className="mx-auto max-w-[860px]">
          <h2 className="text-center text-[30px] font-bold tracking-[-0.02em]">Questions, answered</h2>
          <div className="mt-7 space-y-2.5">
            {FAQS.map(([question, answer], index) => (
              <details key={question} open={index === 0} className="group rounded-card border border-gmb-line bg-gmb-surface p-5">
                <summary className="cursor-pointer list-none text-[13.5px] font-semibold">{question}<span className="float-right text-gmb-brand group-open:hidden">+</span><span className="float-right hidden text-gmb-brand group-open:inline">−</span></summary>
                <p className="mt-3 text-[13px] leading-[1.7] text-gmb-ink-muted">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
