"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface WholesalePlan {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: "MONTH" | "YEAR";
  monthlyCredits: number;
  maxLocations: number | null;
  features: string[];
  isDefault: boolean;
}

const BENEFITS = [
  { title: "White-label experience", desc: "Apply your logo, brand colour and powered-by preference across child workspaces." },
  { title: "Set your retail price", desc: "Create resale plans against a live wholesale plan; margin is derived from real plan data." },
  { title: "One customer dashboard", desc: "Onboard customers, manage access, review payments, invoices and Google connection health." },
];

const STEPS = [
  { num: "1", title: "Get access", desc: "Your platform administrator creates a white-label partner workspace." },
  { num: "2", title: "Brand it", desc: "Upload a logo, choose the suite colour and configure the customer-facing identity." },
  { num: "3", title: "Create plans", desc: "Choose wholesale plans, set retail prices and invite customer admins securely." },
  { num: "4", title: "Operate", desc: "Track customer payments and reconcile the monthly wholesale statement." },
];

const isCatalogLimit = (feature: string) =>
  /\b(location|tracked keyword|monthly credit|team member|user)s?\b/i.test(feature);

export function MarketingAgencies() {
  const [plans, setPlans] = useState<WholesalePlan[] | null>(null);

  useEffect(() => {
    void api.get<WholesalePlan[]>("/api/v1/public/plans", { auth: false })
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  const money = (plan: WholesalePlan) => new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: plan.currency,
    maximumFractionDigits: plan.priceCents % 100 === 0 ? 0 : 2,
  }).format(plan.priceCents / 100);

  return (
    <>
      <section className="bg-gmb-night px-6 py-[72px] text-white lg:px-12">
        <div className="mx-auto max-w-[920px]">
          <div className="text-center">
            <span className="font-geist-mono text-[10px] uppercase tracking-[0.12em] text-adm-accent">For agencies</span>
            <h1 className="mt-3.5 text-[38px] font-bold tracking-[-0.025em] md:text-[40px]">Resell GMB Suite under your own brand</h1>
            <p className="mx-auto mt-2.5 max-w-[600px] text-sm text-[#a29fb8]">Brand customer workspaces, set retail pricing and keep the real margin — with tenant-scoped data and an auditable billing trail.</p>
          </div>

          {plans === null ? (
            <div className="mt-9 grid gap-3.5 md:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-64 animate-pulse rounded-panel border border-ptn-line bg-ptn-panel" />)}</div>
          ) : plans.length > 0 ? (
            <div className={`mt-9 grid gap-3.5 ${plans.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
              {plans.map((plan) => (
                <article key={plan.id} className={`relative flex flex-col rounded-panel border p-6 ${plan.isDefault ? "border-ptn-accent bg-adm-hero" : "border-ptn-line bg-ptn-panel"}`}>
                  {plan.isDefault && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-ptn-accent px-3 py-1 font-geist-mono text-micro font-semibold uppercase text-ptn-bg">Current default</span>}
                  <h2 className="text-sm font-semibold">{plan.name}</h2>
                  <div className="mt-3"><span className="text-[30px] font-bold tracking-[-0.03em]">{money(plan)}</span><span className="text-xs text-[#a29fb8]">/{plan.interval === "YEAR" ? "year" : "month"} wholesale</span></div>
                  <p className="mt-2 text-xs text-ptn-accent">You choose the retail price; margin is calculated automatically.</p>
                  <div className="mt-4 flex flex-1 flex-col gap-2 border-t border-white/10 pt-4 text-sm2 text-[#d8d5e6]">
                    <span>· {plan.maxLocations == null ? "Unlimited" : plan.maxLocations} location{plan.maxLocations === 1 ? "" : "s"} per customer</span>
                    <span>· {plan.monthlyCredits.toLocaleString()} monthly credits</span>
                    {plan.features.filter((feature) => !isCatalogLimit(feature)).slice(0, 4).map((feature) => <span key={feature}>· {feature}</span>)}
                  </div>
                  <Link href="/login" className={`mt-5 rounded-control px-4 py-2.5 text-center text-sm2 font-semibold no-underline ${plan.isDefault ? "bg-ptn-accent text-ptn-bg" : "bg-[#262234] text-white"}`}>Open partner portal</Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="mx-auto mt-9 max-w-xl rounded-card border border-ptn-line bg-ptn-panel p-7 text-center">
              <h2 className="text-base font-semibold">Wholesale catalog is being prepared</h2>
              <p className="mt-2 text-sm2 text-[#a29fb8]">Sign in if you already have partner access, or contact the platform team for onboarding.</p>
              <Link href="/login" className="mt-5 inline-block rounded-control bg-ptn-accent px-5 py-2.5 text-sm2 font-semibold text-ptn-bg">Partner login</Link>
            </div>
          )}
        </div>
      </section>

      <section className="px-6 py-16 lg:px-12">
        <div className="mx-auto max-w-[920px]">
          <h2 className="text-center text-[28px] font-bold tracking-[-0.02em]">Built for the way agencies scale</h2>
          <div className="mt-8 grid gap-3.5 md:grid-cols-3">
            {BENEFITS.map((benefit) => <div key={benefit.title} className="rounded-card border border-gmb-line bg-gmb-surface p-5"><h3 className="text-sm font-semibold">{benefit.title}</h3><p className="mt-1.5 text-sm2 leading-relaxed text-gmb-ink-muted">{benefit.desc}</p></div>)}
          </div>
        </div>
      </section>

      <section className="border-t border-gmb-line-soft bg-gmb-surface px-6 py-14 lg:px-12">
        <div className="mx-auto max-w-[860px]">
          <h2 className="text-center text-[26px] font-bold tracking-[-0.02em]">Live in four clear steps</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => <div key={step.num}><span className="text-[34px] font-bold text-gmb-brand-tint">{step.num}</span><h3 className="mt-1.5 text-[13px] font-semibold">{step.title}</h3><p className="mt-1 text-xs2 leading-relaxed text-gmb-ink-muted">{step.desc}</p></div>)}
          </div>
        </div>
      </section>

      <section className="px-6 py-14 lg:px-12">
        <div className="mx-auto max-w-[860px]">
          <h2 className="text-center text-[26px] font-bold tracking-[-0.02em]">What partners ask before signing up</h2>
          <div className="mt-7 space-y-2.5">
            {[
              ["Do customers see Adgrowly?", "Your configured logo, colour and powered-by preference apply in the customer suite. A custom domain still requires the matching DNS and deployment setup."],
              ["How does billing work?", "Partner payments are scoped to child customers. The monthly statement derives wholesale cost and margin from real plan and payment records; it never fabricates revenue."],
              ["Can staff access every customer?", "Partner roles are tenant-scoped. A partner can manage its own child workspaces, not another partner’s customers or platform-wide data."],
              ["Where are gateway keys stored?", "Keys are encrypted in the partner-scoped Secret Vault, and browser responses expose only configured state and last-four masks."],
            ].map(([question, answer]) => <div key={question} className="rounded-card border border-gmb-line bg-gmb-surface p-5"><h3 className="text-[13.5px] font-semibold">{question}</h3><p className="mt-1.5 text-sm2 leading-relaxed text-gmb-ink-muted">{answer}</p></div>)}
          </div>
        </div>
      </section>
    </>
  );
}
