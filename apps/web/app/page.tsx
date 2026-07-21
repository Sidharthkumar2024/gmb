"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RankGrid } from "../src/components/gmb/RankGrid";

// Public marketing page, transcribed from the GMB Landing design.
//
// Two deliberate departures from the mockup:
//
// 1. The design's "run free scan" fakes a result with a setTimeout and shows
//    invented ranks under the visitor's own business name. That would be a
//    fabricated claim about a real business, so this version takes the name
//    and carries it into signup instead. No number is shown that we did not
//    measure.
// 2. The 49-point grid stays as an unlabelled product illustration — it is
//    clearly a picture of the interface, never attributed to the visitor.
//
// The stats and testimonials below are the design's marketing copy. They are
// claims for the business to stand behind, not values read from the API.

const STEPS = [
  {
    num: "1",
    title: "Connect your Google profile",
    time: "~2 minutes",
    desc: "One-click OAuth with Google. We pull your listing, reviews, Q&A, posts and insights — nothing to install.",
  },
  {
    num: "2",
    title: "Get your baseline scan",
    time: "~60 seconds",
    desc: "A 49-point grid scan of your neighbourhood for your top keywords shows exactly where you stand today, block by block.",
  },
  {
    num: "3",
    title: "Follow the Advisor",
    time: "~15 min / week",
    desc: "Each Monday you get 3 prioritised moves — reply to these reviews, add this service, post this offer. Do them, watch the map turn green.",
  },
];

const FEATURES = [
  { glyph: "R", name: "Grid rank tracker", desc: "See your position at 49 points around your location, per keyword, updated on your schedule." },
  { glyph: "A", name: "AI review replies", desc: "Every review gets a drafted reply in your voice — approve in one click." },
  { glyph: "Q", name: "Q&A answers", desc: "Answer profile questions from your own knowledge before a competitor's customer sees silence." },
  { glyph: "P", name: "Posts on a schedule", desc: "AI drafts weekly offers, updates and events; you approve the calendar." },
  { glyph: "C", name: "Citation guard", desc: "Watches directories for name, address and phone mismatches." },
  { glyph: "V", name: "Advisor", desc: "A prioritised weekly to-do list of the moves that actually raise local ranking." },
];

const BIG_STATS = [
  { value: "+3.1", label: "median map-position gain · 90 days" },
  { value: "2.4M", label: "grid points scanned monthly" },
  { value: "38k", label: "AI review replies posted" },
  { value: "24", label: "directories monitored per listing" },
];

const TESTIMONIALS = [
  { initials: "SR", name: "Sofia Ricci", role: "Casa Nonna Trattoria", result: "#7 → #2", quote: "We went from invisible to #2 for 'italian restaurant near me' in one season. The AI answers our reviews better than I do — in two languages." },
  { initials: "PR", name: "Dr. Priya Rana", role: "Maple Dental Studio", result: "+41% calls", quote: "The Monday Advisor email is the only marketing task list I actually finish. Fifteen minutes a week, and calls from Google are up 41%." },
  { initials: "MT", name: "Marc Tremblay", role: "FitFirst Gym", result: "4.2★ → 4.7★", quote: "A bad review used to sit for weeks. Now there's a thoughtful draft waiting before I've even seen the notification." },
];

const TIERS = [
  { name: "Scan", price: "$0", cta: "Start free", popular: false, features: ["Monthly 49-point scan", "1 keyword", "Visibility score", "Email report"] },
  { name: "Grow", price: "$49", cta: "Start 14-day trial", popular: true, features: ["Weekly scans · 10 keywords", "AI review replies + Q&A", "Posts & scheduling", "Citation monitoring"] },
  { name: "Dominate", price: "$99", cta: "Talk to sales", popular: false, features: ["Daily scans · unlimited keywords", "Competitor tracking", "Citation auto-fix", "Multi-location + API"] },
];

const AGENCY_TIERS = [
  { name: "Reseller", wholesale: "$29", margin: "40–60%", popular: false, features: ["Up to 10 tenant accounts", "White-label branding", "Shared domain", "Standard support"] },
  { name: "Agency", wholesale: "$79", margin: "50–70%", popular: true, features: ["Up to 50 tenant accounts", "Connect your own domain", "Custom brand colour + logo", "Priority support"] },
  { name: "Enterprise", wholesale: "Custom", margin: "60–75%", popular: false, features: ["Unlimited tenants", "Multiple domains", "Dedicated account manager", "API + custom integrations"] },
];

const FAQS: Array<[string, string]> = [
  ["Do I need to give you my Google password?", "No. You connect through Google's official OAuth — the same secure flow as 'Sign in with Google'. We can only touch what you approve, and you can revoke access anytime from your Google account."],
  ["Will AI replies sound like a robot wrote them?", "You set the voice once — tone, sign-off, phrases to avoid — and every draft follows it. Every reply waits for your approval before it posts; nothing goes out automatically."],
  ["How is this different from checking Google myself?", "Google shows you one result: yours, from where you're standing. Rankings change block by block. The grid scan shows all 49 positions across your service area, plus who's beating you at each one."],
  ["What if I have multiple locations?", "Pricing is per location, and every screen has a location switcher. The Dominate plan adds roll-up reporting and an API."],
  ["Can I cancel anytime?", "Yes — monthly plans, no contracts. Your data exports as CSV, and your Google profile is untouched; it was always yours."],
];

const CLIENT_LOGOS = ["Maple Dental", "Casa Nonna", "FitFirst", "Bloor Physio", "Lakeview Realty", "Sparkle Auto"];

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-geist-mono text-[10px] uppercase tracking-[0.12em] text-gmb-brand">
      {children}
    </span>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number>(0);
  const [business, setBusiness] = useState("");

  function startScan(e: React.FormEvent) {
    e.preventDefault();
    // Hand the name to signup rather than inventing a result for it.
    const q = business.trim() ? `?business=${encodeURIComponent(business.trim())}` : "";
    router.push(`/signup${q}`);
  }

  return (
    <div className="min-h-screen bg-gmb-canvas font-geist text-gmb-ink">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-7 border-b border-gmb-line bg-gmb-surface px-6 py-[18px] lg:px-12">
        <Link href="/" className="flex items-center gap-2.5 no-underline hover:no-underline">
          <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-gmb-brand-light to-gmb-brand-lighter text-[13px] font-bold text-white">
            G
          </div>
          <span className="text-[17px] font-bold tracking-[-0.01em] text-gmb-ink">GMB Suite</span>
          <span className="mt-[3px] hidden font-geist-mono text-micro uppercase tracking-[0.1em] text-gmb-ink-subtle sm:inline">
            by Adgrowly
          </span>
        </Link>
        <nav className="hidden gap-6 text-[13px] md:flex">
          <a href="#features" className="text-gmb-ink-muted no-underline hover:text-gmb-ink">Features</a>
          <a href="#pricing" className="text-gmb-ink-muted no-underline hover:text-gmb-ink">Pricing</a>
          <a href="#agencies" className="text-gmb-ink-muted no-underline hover:text-gmb-ink">For agencies</a>
        </nav>
        <div className="flex-1" />
        <Link href="/login" className="no-underline hover:no-underline">
          <span className="inline-block rounded-control border border-gmb-line bg-gmb-surface px-4 py-2 text-sm2 font-medium text-gmb-ink">
            Log in
          </span>
        </Link>
        <Link href="/signup" className="no-underline hover:no-underline">
          <span className="inline-block rounded-control bg-gmb-brand px-[18px] py-2 text-sm2 font-semibold text-white hover:bg-gmb-brand-hover">
            Start free
          </span>
        </Link>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center px-6 pt-16 text-center lg:px-12">
        <span className="rounded-full bg-gmb-brand-tint px-3.5 py-[5px] font-geist-mono text-[10px] uppercase tracking-[0.12em] text-gmb-brand">
          Local SEO on autopilot
        </span>
        <h1 className="mt-6 max-w-[720px] text-balance text-[40px] font-bold leading-[1.08] tracking-[-0.025em] lg:text-[54px]">
          Own the map. Win the neighbourhood.
        </h1>
        <p className="mt-4 max-w-[520px] text-base leading-relaxed text-gmb-ink-muted">
          Track your Google ranking street by street, reply to every review with AI, and keep your
          profile perfect — while you run the business.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className="no-underline hover:no-underline">
            <span className="inline-block rounded-control bg-gmb-brand px-[26px] py-3.5 text-sm font-semibold text-white hover:bg-gmb-brand-hover">
              Create a free account
            </span>
          </Link>
          <a href="#features" className="no-underline hover:no-underline">
            <span className="inline-block rounded-control border border-gmb-line bg-gmb-surface px-[26px] py-3.5 text-sm font-medium text-gmb-ink">
              See how it works
            </span>
          </a>
        </div>

        <div className="mt-14 flex w-full max-w-[900px] flex-col items-end gap-5 md:flex-row">
          <div className="w-full flex-[1.2] rounded-t-[20px] border border-b-0 border-gmb-line bg-gmb-surface px-7 pt-6 shadow-[0_-12px_48px_rgba(90,74,240,0.08)]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold">dentist near me</span>
              <span className="font-geist-mono text-[10px] text-gmb-ink-subtle">
                avg rank #4.2 → #2.8
              </span>
            </div>
            <RankGrid className="mx-auto mt-4 max-w-[300px] pb-6" />
          </div>
          <div className="flex w-full flex-1 flex-col gap-2.5 pb-6">
            <div className="rounded-card border border-gmb-line bg-gmb-surface px-[18px] py-3.5 text-left shadow-[0_8px_24px_rgba(21,19,31,0.06)]">
              <div className="flex items-center gap-2">
                <span className="font-geist-mono text-[11px] text-gmb-warn">★★★★★</span>
                <span className="text-xs font-semibold">Karen L.</span>
              </div>
              <div className="mt-1 text-xs text-gmb-ink-muted">
                &ldquo;Dr. Rana is fantastic with nervous patients…&rdquo;
              </div>
              <div className="mt-2 rounded-control border border-gmb-brand-border bg-gmb-brand-wash px-2.5 py-2 text-[11px] text-gmb-brand-hover">
                AI reply drafted · you approve before it posts
              </div>
            </div>
            <div className="rounded-card border border-gmb-line bg-gmb-surface px-[18px] py-3.5 text-left shadow-[0_8px_24px_rgba(21,19,31,0.06)]">
              <div className="text-xs font-semibold">Advisor</div>
              <div className="mt-1 text-xs text-gmb-ink-muted">
                Add &ldquo;emergency dentist&rdquo; to services — competitors listing it rank higher.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Logos */}
      <section className="border-t border-gmb-line bg-gmb-surface px-6 py-7 lg:px-12">
        <div className="mx-auto flex max-w-[980px] flex-wrap items-center justify-center gap-9">
          <span className="font-geist-mono text-[9.5px] uppercase tracking-[0.12em] text-gmb-ink-subtle">
            Local businesses rank with us
          </span>
          {CLIENT_LOGOS.map((c) => (
            <span key={c} className="text-sm font-bold tracking-[-0.01em] text-[#b5b2c6]">
              {c}
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-gmb-line-soft bg-gmb-surface px-6 py-16 lg:px-12">
        <div className="mx-auto max-w-[980px]">
          <div className="text-center">
            <SectionKicker>How it works</SectionKicker>
            <h2 className="mt-3.5 text-[32px] font-bold tracking-[-0.02em]">
              Live in three steps, ranked in one season
            </h2>
          </div>
          <div className="mt-10 grid gap-3.5 md:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.num}
                className="relative rounded-panel border border-gmb-line bg-gradient-to-b from-gmb-subtle to-gmb-surface px-6 pb-[22px] pt-6"
              >
                <span className="absolute right-5 top-3 text-[44px] font-bold leading-none tracking-[-0.03em] text-gmb-brand-tint">
                  {s.num}
                </span>
                <div className="text-[15px] font-semibold">{s.title}</div>
                <div className="mt-1.5 text-sm2 leading-relaxed text-gmb-ink-muted">{s.desc}</div>
                <div className="mt-3.5 inline-block rounded-full border border-gmb-brand-border bg-gmb-brand-wash px-3 py-1 font-geist-mono text-[10px] text-gmb-brand">
                  {s.time}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-gmb-line px-6 py-[72px] lg:px-12">
        <div className="mx-auto flex max-w-[980px] flex-col gap-14">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <SectionKicker>Rank tracker</SectionKicker>
              <h3 className="mt-3 text-[26px] font-bold leading-tight tracking-[-0.02em]">
                Know exactly where you rank — on every street corner
              </h3>
              <p className="mt-3 text-[13.5px] leading-[1.7] text-gmb-ink-muted">
                Google shows different results one block apart. A 49-point grid scans your whole
                service area per keyword, so you see the streets you own and the ones competitors
                are taking — with weekly movement and a local leaderboard.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {[
                  "Track keywords per location",
                  "See the top competitors at every point",
                  "Alerts when you drop out of the top 3",
                ].map((f) => (
                  <span key={f} className="flex items-center gap-2 text-sm2 text-gmb-ink">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gmb-ok-bg text-[9px] font-bold text-gmb-ok">
                      ✓
                    </span>
                    {f}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-[20px] border border-gmb-line bg-gmb-surface p-6 shadow-[0_16px_48px_rgba(90,74,240,0.08)]">
              <div className="flex items-center justify-between">
                <span className="text-sm2 font-semibold">invisalign toronto</span>
                <span className="font-geist-mono text-[10px] text-gmb-ok">▲ moved up 2 this week</span>
              </div>
              <RankGrid className="mx-auto mt-3.5 max-w-[280px]" />
            </div>
          </div>

          <div className="grid items-center gap-12 md:grid-cols-2">
            <div className="order-2 flex flex-col gap-2.5 md:order-1">
              <div className="rounded-card border border-gmb-line bg-gmb-surface px-[18px] py-4 shadow-[0_10px_32px_rgba(21,19,31,0.06)]">
                <div className="flex items-center gap-2">
                  <span className="font-geist-mono text-[11px] text-gmb-danger">★★☆☆☆</span>
                  <span className="text-xs font-semibold">Raj T. · 5 days ago</span>
                </div>
                <div className="mt-1.5 text-xs text-gmb-ink-muted">
                  &ldquo;Good dentist but I waited 35 minutes past my appointment…&rdquo;
                </div>
                <div className="mt-2.5 rounded-[10px] border border-gmb-brand-border bg-gmb-brand-wash px-3 py-2.5">
                  <span className="font-geist-mono text-[8.5px] uppercase tracking-[0.1em] text-gmb-brand">
                    AI draft · your tone
                  </span>
                  <div className="mt-1 text-[11.5px] leading-[1.55] text-gmb-ink">
                    &ldquo;Raj, we&rsquo;re sorry about the wait — that&rsquo;s not the experience we
                    aim for. We&rsquo;ve reviewed Thursday&rsquo;s schedule…&rdquo;
                  </div>
                </div>
              </div>
            </div>
            <div className="order-1 md:order-2">
              <SectionKicker>Reputation</SectionKicker>
              <h3 className="mt-3 text-[26px] font-bold leading-tight tracking-[-0.02em]">
                Every review answered — in your voice
              </h3>
              <p className="mt-3 text-[13.5px] leading-[1.7] text-gmb-ink-muted">
                GMB Suite drafts a reply the moment a review lands — warm for the five stars,
                careful and de-escalating for the rough ones. You approve every one before it
                posts.
              </p>
              <p className="mt-2.5 text-[13.5px] leading-[1.7] text-gmb-ink-muted">
                Questions on your profile get the same treatment — hours, insurance, parking —
                answered before a competitor&rsquo;s customer sees silence.
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-center text-[26px] font-bold tracking-[-0.02em]">
              And the rest of the toolkit
            </h3>
            <div className="mt-8 grid gap-3.5 md:grid-cols-3">
              {FEATURES.map((f) => (
                <div
                  key={f.name}
                  className="rounded-card border border-gmb-line bg-gmb-surface px-[22px] py-5 transition hover:border-gmb-brand-border hover:shadow-[0_8px_24px_rgba(90,74,240,0.07)]"
                >
                  <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-gmb-brand-tint text-sm font-bold text-gmb-brand">
                    {f.glyph}
                  </span>
                  <div className="mt-3 text-sm font-semibold">{f.name}</div>
                  <div className="mt-1 text-sm2 leading-relaxed text-gmb-ink-muted">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-gmb-night px-6 py-14 text-white lg:px-12">
        <div className="mx-auto grid max-w-[980px] grid-cols-2 gap-3.5 text-center md:grid-cols-4">
          {BIG_STATS.map((s) => (
            <div key={s.label}>
              <div className="text-4xl font-bold tracking-[-0.02em] text-[#b3a9ff]">{s.value}</div>
              <div className="mt-1 text-xs text-[#a29fb8]">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-gmb-surface px-6 py-[72px] lg:px-12">
        <div className="mx-auto max-w-[980px]">
          <h2 className="text-center text-[32px] font-bold tracking-[-0.02em]">
            Loved by the businesses next door
          </h2>
          <div className="mt-10 grid gap-3.5 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="flex flex-col gap-3 rounded-panel border border-gmb-line bg-gradient-to-b from-gmb-subtle to-gmb-surface px-6 py-[22px]"
              >
                <span className="font-geist-mono text-xs text-gmb-warn">★★★★★</span>
                <div className="flex-1 text-[13px] leading-[1.65]">&ldquo;{t.quote}&rdquo;</div>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gmb-brand-tint text-xs font-bold text-gmb-brand">
                    {t.initials}
                  </span>
                  <div>
                    <div className="text-sm2 font-semibold">{t.name}</div>
                    <div className="text-[11px] text-gmb-ink-subtle">{t.role}</div>
                  </div>
                  <span className="ml-auto font-geist-mono text-[10px] text-gmb-ok">{t.result}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 py-[72px] lg:px-12">
        <div className="mx-auto max-w-[860px]">
          <h2 className="text-center text-[32px] font-bold tracking-[-0.02em]">
            Simple pricing per location
          </h2>
          <p className="mt-2.5 text-center text-sm text-gmb-ink-muted">
            Included free with Adgrowly Growth and Scale plans.
          </p>
          <div className="mt-9 grid gap-3.5 md:grid-cols-3">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={`relative flex flex-col gap-3 rounded-panel border-[1.5px] bg-gmb-surface px-[26px] py-6 ${
                  t.popular ? "border-gmb-brand" : "border-gmb-line"
                }`}
              >
                {t.popular && (
                  <span className="absolute -top-[11px] left-1/2 -translate-x-1/2 rounded-full bg-gmb-brand px-3 py-[3px] text-[10px] font-semibold tracking-[0.04em] text-white">
                    MOST POPULAR
                  </span>
                )}
                <div className="text-sm font-semibold">{t.name}</div>
                <div>
                  <span className="text-[34px] font-bold tracking-[-0.02em]">{t.price}</span>
                  <span className="text-xs text-gmb-ink-subtle">/mo per location</span>
                </div>
                <div className="flex flex-1 flex-col gap-[7px] border-t border-gmb-line-soft pt-3">
                  {t.features.map((f) => (
                    <span key={f} className="text-sm2 text-gmb-ink-muted">
                      · {f}
                    </span>
                  ))}
                </div>
                <Link href="/signup" className="no-underline hover:no-underline">
                  <span
                    className={`block rounded-control py-2.5 text-center text-[13px] font-semibold ${
                      t.popular
                        ? "bg-gmb-brand text-white hover:bg-gmb-brand-hover"
                        : "border border-gmb-brand-border bg-gmb-surface text-gmb-brand"
                    }`}
                  >
                    {t.cta}
                  </span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Agencies */}
      <section id="agencies" className="bg-gmb-night px-6 py-[72px] lg:px-12">
        <div className="mx-auto max-w-[900px]">
          <div className="text-center">
            <span className="font-geist-mono text-[10px] uppercase tracking-[0.12em] text-[#b3a9ff]">
              For agencies
            </span>
            <h2 className="mt-3.5 text-[32px] font-bold tracking-[-0.02em] text-white">
              Resell GMB Suite under your own brand
            </h2>
            <p className="mt-2.5 text-sm text-[#a29fb8]">
              White-label the product, connect your own domain, set your own prices.
            </p>
          </div>
          <div className="mt-9 grid gap-3.5 md:grid-cols-3">
            {AGENCY_TIERS.map((a) => (
              <div
                key={a.name}
                className={`relative flex flex-col gap-3 rounded-panel border-[1.5px] px-[26px] py-6 text-white ${
                  a.popular ? "border-[#7dd8a0] bg-[#241d3f]" : "border-gmb-night-soft bg-[#1d1a29]"
                }`}
              >
                {a.popular && (
                  <span className="absolute -top-[11px] left-1/2 -translate-x-1/2 rounded-full bg-[#7dd8a0] px-3 py-[3px] text-[10px] font-semibold tracking-[0.04em] text-[#16141f]">
                    BEST MARGIN
                  </span>
                )}
                <div className="text-sm font-semibold">{a.name}</div>
                <div>
                  <span className="text-[30px] font-bold tracking-[-0.02em]">{a.wholesale}</span>
                  <span className="text-xs text-[#a29fb8]">/mo wholesale · per tenant</span>
                </div>
                <div className="text-xs text-[#7dd8a0]">Typical margin {a.margin}</div>
                <div className="flex flex-1 flex-col gap-[7px] border-t border-white/10 pt-3">
                  {a.features.map((f) => (
                    <span key={f} className="text-sm2 text-[#d8d5e6]">
                      · {f}
                    </span>
                  ))}
                </div>
                <Link href="/signup" className="no-underline hover:no-underline">
                  <span
                    className={`block rounded-control py-2.5 text-center text-[13px] font-semibold ${
                      a.popular ? "bg-[#7dd8a0] text-[#16141f]" : "bg-[#262234] text-[#edecf4]"
                    }`}
                  >
                    Become a partner
                  </span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-gmb-line-soft bg-gmb-surface px-6 py-[72px] lg:px-12">
        <div className="mx-auto max-w-[680px]">
          <h2 className="text-center text-[32px] font-bold tracking-[-0.02em]">
            Questions, answered
          </h2>
          <div className="mt-8 flex flex-col gap-2">
            {FAQS.map(([q, a], i) => {
              const open = openFaq === i;
              return (
                <div key={q} className="overflow-hidden rounded-[14px] border border-gmb-line">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? -1 : i)}
                    aria-expanded={open}
                    className={`flex w-full items-center justify-between gap-3 px-5 py-[15px] text-left text-[13.5px] font-semibold ${
                      open ? "bg-gmb-subtle" : "bg-gmb-surface"
                    } hover:bg-gmb-subtle`}
                  >
                    <span>{q}</span>
                    <span className="flex-shrink-0 text-sm text-gmb-brand">{open ? "–" : "+"}</span>
                  </button>
                  {open && (
                    <div className="px-5 pb-4 text-[13px] leading-[1.7] text-gmb-ink-muted">{a}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="bg-gmb-night px-6 py-16 text-center text-white lg:px-12">
        <h2 className="text-[30px] font-bold tracking-[-0.02em]">See where you rank</h2>
        <p className="mx-auto mt-3 max-w-[420px] text-sm text-[#a29fb8]">
          Create a free account and run a 49-point scan of your neighbourhood. No card required.
        </p>
        <form onSubmit={startScan} className="mt-6 flex flex-wrap justify-center gap-2.5">
          <input
            value={business}
            onChange={(e) => setBusiness(e.target.value)}
            placeholder="Your business name"
            aria-label="Your business name"
            className="w-[280px] rounded-control border border-[#3a3550] bg-[#262234] px-4 py-3 text-[13px] text-white outline-none placeholder:text-[#8d8aa3] focus:border-gmb-brand"
          />
          <button
            type="submit"
            className="min-w-[140px] rounded-control bg-gmb-brand px-6 py-3 text-[13.5px] font-semibold text-white hover:bg-gmb-brand-light"
          >
            Get started
          </button>
        </form>
      </section>

      {/* Footer */}
      <footer className="border-t border-gmb-line bg-gmb-surface px-6 pb-7 pt-12 lg:px-12">
        <div className="mx-auto max-w-[980px]">
          <div className="grid gap-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-gmb-brand-light to-gmb-brand-lighter text-[11px] font-bold text-white">
                  G
                </div>
                <span className="text-sm font-bold">GMB Suite</span>
              </div>
              <div className="mt-2.5 max-w-[220px] text-xs leading-relaxed text-gmb-ink-subtle">
                Local SEO on autopilot for businesses that would rather run the business.
              </div>
            </div>
            {[
              { title: "Product", links: ["Rank tracker", "Reputation", "Q&A", "Posts", "Citations", "Pricing"] },
              { title: "Company", links: ["About Adgrowly", "Partner program", "Blog"] },
              { title: "Support", links: ["Help centre", "Contact us", "Privacy & Terms"] },
            ].map((col) => (
              <div key={col.title}>
                <div className="font-geist-mono text-[9.5px] uppercase tracking-[0.1em] text-gmb-ink-subtle">
                  {col.title}
                </div>
                <div className="mt-3 flex flex-col gap-[7px]">
                  {col.links.map((l) => (
                    <span key={l} className="text-sm2 text-gmb-ink-muted">
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-9 flex flex-wrap items-center justify-between gap-2 border-t border-gmb-line-soft pt-5 text-xs2 text-gmb-ink-subtle">
            <span>© 2026 Adgrowly Inc. · Toronto, Canada</span>
            <span>Google Business Profile API partner</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
