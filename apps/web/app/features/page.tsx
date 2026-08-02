import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "../../src/components/gmb/MarketingShell";
import { RankGrid } from "../../src/components/gmb/RankGrid";

export const metadata: Metadata = {
  title: "Features — GMB Suite by Adgrowly",
  description: "Rank tracking, reputation, posts, citations and Google Business Profile automation.",
};

const TOOLKIT = [
  { glyph: "Q", name: "Q&A assistant", desc: "Draft useful answers from your business details, then approve before publishing." },
  { glyph: "P", name: "Posts & scheduling", desc: "Plan offers and updates, attach durable media, and publish to the selected location." },
  { glyph: "C", name: "Citation tracker", desc: "Track directory listings and surface name, address and phone inconsistencies." },
  { glyph: "A", name: "Weekly Advisor", desc: "Turn rankings, reviews and profile health into a prioritised action list." },
  { glyph: "I", name: "Performance insights", desc: "Sync profile views and customer actions with period-over-period comparisons." },
  { glyph: "R", name: "Branded reports", desc: "Generate downloadable reports and schedule recurring performance snapshots." },
];

const STAGES = [
  { tag: "Discover", title: "See the neighbourhood, not one search", desc: "A geo-grid shows how visibility changes block by block and which competitors occupy the local pack." },
  { tag: "Trust", title: "Respond while the customer is listening", desc: "Review and Q&A drafts keep the profile active while every sensitive response remains under your control." },
  { tag: "Convert", title: "Keep the profile complete", desc: "Locations, action links, images and posts live in one workflow with honest Google sync states." },
  { tag: "Improve", title: "Work the highest-impact task next", desc: "Advisor recommendations connect profile gaps to the screen where the work can be completed." },
];

export default function FeaturesPage() {
  return (
    <MarketingShell active="features">
      <section className="px-6 pb-2 pt-16 text-center lg:px-12">
        <span className="rounded-full bg-gmb-brand-tint px-3.5 py-[5px] font-geist-mono text-[10px] uppercase tracking-[0.12em] text-gmb-brand">Full toolkit</span>
        <h1 className="mx-auto mt-5 max-w-[760px] text-[38px] font-bold leading-tight tracking-[-0.025em] md:text-[42px]">
          Everything your Google profile needs
        </h1>
        <p className="mx-auto mt-3.5 max-w-[580px] text-[15px] leading-relaxed text-gmb-ink-muted">
          Rank tracking, reputation, Q&A, posting and citations — one dashboard with every live action clearly separated from drafts.
        </p>
        <div className="mx-auto mt-8 grid max-w-[900px] gap-3 rounded-[20px] border border-gmb-line bg-gmb-surface p-5 text-left shadow-[0_24px_64px_rgba(90,74,240,0.12)] md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-card border border-gmb-line bg-gmb-subtle p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm2 font-semibold">dentist near me</span>
              <span className="font-geist-mono text-micro text-gmb-ok">live grid result</span>
            </div>
            <RankGrid className="mx-auto mt-4 max-w-[310px]" />
          </div>
          <div className="flex flex-col gap-3">
            {["Reply to 3 waiting reviews", "Add one missing service", "Schedule this week’s post"].map((task, index) => (
              <div key={task} className="flex flex-1 items-start gap-3 rounded-card border border-gmb-line bg-gmb-surface p-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gmb-brand-tint font-geist-mono text-micro font-bold text-gmb-brand">{index + 1}</span>
                <div>
                  <div className="text-sm2 font-semibold">{task}</div>
                  <div className="mt-1 text-xs text-gmb-ink-muted">Open the exact workflow and keep the result reviewable.</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16 lg:px-12">
        <div className="mx-auto flex max-w-[980px] flex-col gap-16">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <span className="font-geist-mono text-[10px] uppercase tracking-[0.12em] text-gmb-brand">Rank tracker</span>
              <h2 className="mt-3 text-[26px] font-bold leading-tight tracking-[-0.02em]">Know exactly where you rank — on every street corner</h2>
              <p className="mt-3 text-[13.5px] leading-[1.7] text-gmb-ink-muted">
                Google results change with distance. Scan a 49-point service area per keyword, compare competitors and create alerts when visibility drops.
              </p>
              <ul className="mt-4 space-y-2 text-sm2">
                {["Track keywords per connected location", "Keep historical snapshots and competitors", "Send rank-drop alerts to a chosen email"].map((item) => (
                  <li key={item} className="flex items-center gap-2"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-gmb-ok-bg text-[9px] font-bold text-gmb-ok">✓</span>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-[20px] border border-gmb-line bg-gmb-surface p-6 shadow-[0_16px_48px_rgba(90,74,240,0.08)]">
              <div className="flex items-center justify-between"><span className="text-sm2 font-semibold">invisalign toronto</span><span className="font-geist-mono text-micro text-gmb-ok">▲ moved up 2</span></div>
              <RankGrid className="mx-auto mt-4 max-w-[280px]" />
            </div>
          </div>

          <div className="grid items-center gap-12 md:grid-cols-2">
            <div className="order-2 space-y-3 md:order-1">
              <div className="rounded-card border border-gmb-line bg-gmb-surface p-5 shadow-[0_10px_32px_rgba(21,19,31,0.06)]">
                <div className="flex items-center gap-2"><span className="font-geist-mono text-xs text-gmb-danger">★★☆☆☆</span><span className="text-xs font-semibold">Recent Google review</span></div>
                <p className="mt-2 text-xs text-gmb-ink-muted">“Good service, but the wait was longer than expected.”</p>
                <div className="mt-3 rounded-control border border-gmb-brand-border bg-gmb-brand-wash p-3 text-xs2 leading-relaxed text-gmb-ink">
                  <span className="font-geist-mono text-micro uppercase tracking-wide text-gmb-brand">AI draft · awaiting approval</span>
                  <p className="mt-1">Thank you for the honest feedback. We’re reviewing the schedule and would value another chance to serve you.</p>
                </div>
              </div>
            </div>
            <div className="order-1 md:order-2">
              <span className="font-geist-mono text-[10px] uppercase tracking-[0.12em] text-gmb-brand">Reputation</span>
              <h2 className="mt-3 text-[26px] font-bold leading-tight tracking-[-0.02em]">Every review answered — in your voice</h2>
              <p className="mt-3 text-[13.5px] leading-[1.7] text-gmb-ink-muted">
                Draft thoughtful replies, edit freely, and publish to Google only when the profile connection and review resource are valid. Nothing is marked posted when it stayed local.
              </p>
            </div>
          </div>

          <div>
            <h2 className="text-center text-[26px] font-bold tracking-[-0.02em]">And the rest of the toolkit</h2>
            <div className="mt-8 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {TOOLKIT.map((feature) => (
                <div key={feature.name} className="rounded-card border border-gmb-line bg-gmb-surface p-5 transition hover:border-gmb-brand-border hover:shadow-[0_8px_24px_rgba(90,74,240,0.07)]">
                  <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-gmb-brand-tint text-sm font-bold text-gmb-brand">{feature.glyph}</span>
                  <h3 className="mt-3 text-sm font-semibold">{feature.name}</h3>
                  <p className="mt-1 text-sm2 leading-relaxed text-gmb-ink-muted">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-gmb-line-soft bg-gmb-surface px-6 py-14 lg:px-12">
        <div className="mx-auto max-w-[980px]">
          <h2 className="text-center text-[26px] font-bold tracking-[-0.02em]">Built for every stage of the funnel</h2>
          <div className="mt-8 grid gap-3.5 md:grid-cols-2">
            {STAGES.map((stage) => (
              <div key={stage.tag} className="rounded-card border border-gmb-line bg-gmb-surface p-6">
                <span className="font-geist-mono text-micro uppercase tracking-[0.1em] text-gmb-brand">{stage.tag}</span>
                <h3 className="mt-2 text-[15px] font-semibold">{stage.title}</h3>
                <p className="mt-1.5 text-sm2 leading-relaxed text-gmb-ink-muted">{stage.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gmb-night px-6 py-14 text-center text-white lg:px-12">
        <h2 className="text-[28px] font-bold tracking-[-0.02em]">Ready to see your grid?</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-[#a29fb8]">Create your workspace, connect Google and run the first scan from your own location data.</p>
        <Link href="/signup" className="mt-5 inline-block rounded-control bg-gmb-brand px-6 py-3 text-[13.5px] font-semibold text-white no-underline">Start free</Link>
      </section>
    </MarketingShell>
  );
}
