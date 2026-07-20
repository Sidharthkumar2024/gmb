"use client";

// GMB AI Manager (Complete Planning PDF §2.19). Draft Google Business
// Profile posts with AI captions and schedule them. Live publishing to
// Google lands once the Business-Profile OAuth connection exists.

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { GmbBrandedPreview, type BrandKitLite } from "../../src/components/GmbBrandedPreview";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const TYPES = ["UPDATE", "OFFER", "EVENT"] as const;
const TONES = ["friendly", "professional"] as const;

// Content calendar (Adgrowly GMB Panel design): chip colors per post type.
const TYPE_CHIP: Record<string, string> = {
  OFFER: "bg-indigo-600 text-white",
  UPDATE: "bg-emerald-600 text-white",
  EVENT: "bg-amber-500 text-white",
};
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

interface GmbPost {
  id: string;
  type: string;
  summary: string;
  callToActionType: string | null;
  scheduledAt: string | null;
  status: string;
  error: string | null;
  publishedAt: string | null;
}

export default function GmbPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<GmbPost[]>([]);
  const [businessName, setBusinessName] = useState("");
  const [type, setType] = useState<string>("UPDATE");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<string>("friendly");
  const [niche, setNiche] = useState<string>("general");
  const [niches, setNiches] = useState<{ key: string; label: string }[]>([]);
  const [brandKit, setBrandKit] = useState<BrandKitLite>({
    logoUrl: null,
    phone: null,
    website: null,
    primaryColor: "#0f766e",
    secondaryColor: "#065f46",
  });
  const [palettes, setPalettes] = useState<{ key: string; label: string; primary: string; secondary: string }[]>([]);
  const [savingKit, setSavingKit] = useState(false);
  const [autopilot, setAutopilot] = useState<{ enabled: boolean; cadenceHours: number; postsPerRun: number; autoDraftReplies: boolean; lastRunAt: string | null }>({
    enabled: false,
    cadenceHours: 168,
    postsPerRun: 3,
    autoDraftReplies: true,
    lastRunAt: null,
  });
  const [savingAutopilot, setSavingAutopilot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [costs, setCosts] = useState<{ feature: string; label: string; credits: number }[]>([]);
  // Content calendar month (first day of the displayed month).
  const [calMonth, setCalMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  async function refresh() {
    try {
      setErr(null);
      setItems(await api.get<GmbPost[]>("/api/v1/gmb/posts"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load posts.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api
      .get<{ feature: string; label: string; credits: number }[]>("/api/v1/gmb/credit-costs")
      .then(setCosts)
      .catch(() => setCosts([]));
    api
      .get<{ key: string; label: string }[]>("/api/v1/gmb/posts/niches")
      .then(setNiches)
      .catch(() => setNiches([]));
    api
      .get<BrandKitLite>("/api/v1/gmb/brand-kit")
      .then(setBrandKit)
      .catch(() => undefined);
    api
      .get<{ key: string; label: string; primary: string; secondary: string }[]>("/api/v1/gmb/brand-kit/palettes")
      .then(setPalettes)
      .catch(() => setPalettes([]));
    api
      .get<{ enabled: boolean; cadenceHours: number; postsPerRun: number; autoDraftReplies: boolean; lastRunAt: string | null; businessName: string }>("/api/v1/gmb/autopilot")
      .then((c) => {
        setAutopilot({ enabled: c.enabled, cadenceHours: c.cadenceHours, postsPerRun: c.postsPerRun, autoDraftReplies: c.autoDraftReplies, lastRunAt: c.lastRunAt });
        if (c.businessName && !businessName) setBusinessName(c.businessName);
      })
      .catch(() => undefined);
  }, [user]);

  async function saveAutopilot(next: Partial<typeof autopilot>) {
    const merged = { ...autopilot, ...next };
    setAutopilot(merged);
    if (merged.enabled && !businessName.trim()) {
      setErr("Enter a business name before enabling autopilot.");
      setAutopilot((a) => ({ ...a, enabled: false }));
      return;
    }
    setSavingAutopilot(true);
    setErr(null);
    try {
      await api.put("/api/v1/gmb/autopilot", {
        enabled: merged.enabled,
        businessName: businessName.trim() || "our business",
        niche,
        tone,
        postsPerRun: merged.postsPerRun,
        cadenceHours: merged.cadenceHours,
        autoDraftReplies: merged.autoDraftReplies,
      });
      setNotice(merged.enabled ? "Autopilot on — it will draft posts on schedule for your approval." : "Autopilot off.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to save autopilot.");
    } finally {
      setSavingAutopilot(false);
    }
  }

  async function saveBrandKit() {
    setSavingKit(true);
    setErr(null);
    setNotice(null);
    try {
      const saved = await api.put<BrandKitLite>("/api/v1/gmb/brand-kit", {
        logoUrl: brandKit.logoUrl || null,
        phone: brandKit.phone || null,
        website: brandKit.website || null,
        primaryColor: brandKit.primaryColor,
        secondaryColor: brandKit.secondaryColor,
      });
      setBrandKit(saved);
      setNotice("Brand kit saved.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to save brand kit.");
    } finally {
      setSavingKit(false);
    }
  }

  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/posts/generate", {
        businessName: businessName.trim(),
        type,
        topic: topic.trim() || undefined,
        tone,
        niche,
      });
      setTopic("");
      setNotice("Draft post generated.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to generate post.");
    } finally {
      setBusy(false);
    }
  }

  async function schedule(id: string) {
    const when = window.prompt("Schedule at (ISO date-time, e.g. 2026-06-10T09:00:00Z):");
    if (!when) return;
    try {
      await api.post(`/api/v1/gmb/posts/${id}/schedule`, { scheduledAt: new Date(when).toISOString() });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to schedule.");
    }
  }

  async function publishNow(id: string) {
    setErr(null);
    setNotice(null);
    try {
      // Mark due now, then run the publisher immediately (the worker would
      // otherwise pick it up on its next sweep). Live-publishes to Google when
      // the post's location is connected; records local-only otherwise.
      await api.post(`/api/v1/gmb/posts/${id}/schedule`, { scheduledAt: new Date().toISOString() });
      const r = await api.post<{ live: number; localOnly: number; failed: number }>(
        "/api/v1/gmb/posts/run-scheduled",
        {},
      );
      setNotice(
        r.failed > 0
          ? "Publish attempted — check the post for the failure reason."
          : r.live > 0
            ? "Published live to Google."
            : "Marked published (connect a Google location to publish live).",
      );
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to publish.");
    }
  }

  async function runAutopilot() {
    if (!businessName.trim()) {
      setErr("Enter a business name first.");
      return;
    }
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const drafts = await api.post<GmbPost[]>("/api/v1/gmb/posts/autopilot", {
        businessName: businessName.trim(),
        niche,
        tone,
        count: 5,
      });
      setNotice(`Autopilot drafted ${drafts.length} posts — review and approve them below.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Autopilot could not draft posts.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string, schedule: boolean) {
    setErr(null);
    setNotice(null);
    try {
      let scheduledAt: string | null = null;
      if (schedule) {
        const when = window.prompt("Schedule at (ISO date-time, e.g. 2026-08-01T09:00:00Z):");
        if (!when) return;
        scheduledAt = new Date(when).toISOString();
      }
      await api.post(`/api/v1/gmb/posts/${id}/approve`, { scheduledAt });
      setNotice(scheduledAt ? "Approved and scheduled." : "Approved — moved to drafts.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to approve.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this post?")) return;
    try {
      await api.delete(`/api/v1/gmb/posts/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Business Profile posts</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Draft posts with AI captions, then publish now or schedule them.
          Posts go live on Google for connected locations; the rest are saved as
          published records.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">AI content tools:</span>
        {[
          { href: "/gmb-descriptions", label: "Descriptions" },
          { href: "/gmb-images", label: "Images" },
          { href: "/gmb-advisor", label: "Advisor" },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {t.label}
          </Link>
        ))}
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      {/* Content calendar (Adgrowly GMB Panel design): month view of
          scheduled + published posts with type chips. */}
      <section className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-950">
              {calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </h2>
            <button
              onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
              className="rounded-md border border-slate-300 px-2 py-0.5 text-sm text-slate-600 hover:bg-slate-50"
              aria-label="Previous month"
            >
              ‹
            </button>
            <button
              onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
              className="rounded-md border border-slate-300 px-2 py-0.5 text-sm text-slate-600 hover:bg-slate-50"
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-600" /> Offer</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Update</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Event</span>
          </div>
        </div>

        {(() => {
          const year = calMonth.getFullYear();
          const month = calMonth.getMonth();
          const firstWeekday = new Date(year, month, 1).getDay();
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const postsByDay = new Map<number, GmbPost[]>();
          for (const p of items) {
            const when = p.scheduledAt ?? p.publishedAt;
            if (!when) continue;
            const d = new Date(when);
            if (d.getFullYear() !== year || d.getMonth() !== month) continue;
            const day = d.getDate();
            postsByDay.set(day, [...(postsByDay.get(day) ?? []), p]);
          }
          const cells: Array<number | null> = [
            ...Array.from({ length: firstWeekday }, () => null),
            ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
          ];
          return (
            <div className="mt-3">
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1">{w}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => (
                  <div
                    key={i}
                    className={`min-h-[64px] rounded-md border p-1 ${day == null ? "border-transparent" : "border-slate-100 bg-white"}`}
                  >
                    {day != null && (
                      <>
                        <p className="text-xs font-medium text-slate-500">{day}</p>
                        <div className="mt-0.5 space-y-0.5">
                          {(postsByDay.get(day) ?? []).slice(0, 3).map((p) => (
                            <span
                              key={p.id}
                              title={p.summary}
                              className={`block truncate rounded px-1 py-0.5 text-[10px] font-semibold ${TYPE_CHIP[p.type] ?? "bg-slate-200 text-slate-700"} ${p.status === "PUBLISHED" ? "" : "opacity-80"}`}
                            >
                              {p.type.charAt(0) + p.type.slice(1).toLowerCase()}
                            </span>
                          ))}
                          {(postsByDay.get(day)?.length ?? 0) > 3 && (
                            <span className="block text-[10px] text-slate-400">
                              +{(postsByDay.get(day)?.length ?? 0) - 3} more
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </section>

      <div className="grid gap-6 lg:grid-cols-[340px,1fr]">
        <div className="space-y-6">
        <form onSubmit={generate} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">AI draft</h2>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Business name
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required maxLength={120} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Business type
            <select value={niche} onChange={(e) => setNiche(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {niches.length === 0 && <option value="general">General business</option>}
              {niches.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Type
            <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Topic / offer (optional)
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. 20% off this week" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Tone
            <select value={tone} onChange={(e) => setTone(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {(() => {
            const c = costs.find((x) => x.feature === "gmb_post_caption");
            return (
              <button type="submit" disabled={busy} className="mt-5 w-full rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Generating..." : c && c.credits > 0 ? `Generate draft · ${c.credits} credit${c.credits === 1 ? "" : "s"}` : "Generate draft"}
              </button>
            );
          })()}
          <button
            type="button"
            onClick={() => void runAutopilot()}
            disabled={busy}
            className="mt-2 w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            ✨ Autopilot: draft a week of posts
          </button>
          <p className="mt-1 text-center text-[11px] text-slate-400">Drafts land in an approval queue — nothing publishes without your OK.</p>

          {/* Scheduled autopilot — the cron that drafts on a cadence automatically */}
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Run autopilot on a schedule</span>
              <input
                type="checkbox"
                checked={autopilot.enabled}
                disabled={savingAutopilot}
                onChange={(e) => void saveAutopilot({ enabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
            </label>
            <p className="mt-1 text-[11px] text-slate-500">Auto-drafts posts (and review replies) on a cadence — you still approve each one.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[11px] font-medium text-slate-600">
                Every
                <select
                  value={autopilot.cadenceHours}
                  onChange={(e) => void saveAutopilot({ cadenceHours: Number(e.target.value) })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value={24}>Day</option>
                  <option value={72}>3 days</option>
                  <option value={168}>Week</option>
                  <option value={336}>2 weeks</option>
                </select>
              </label>
              <label className="text-[11px] font-medium text-slate-600">
                Posts / run
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={autopilot.postsPerRun}
                  onChange={(e) => void saveAutopilot({ postsPerRun: Number(e.target.value) })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={autopilot.autoDraftReplies}
                onChange={(e) => void saveAutopilot({ autoDraftReplies: e.target.checked })}
                className="rounded border-slate-300"
              />
              Also draft replies for new reviews
            </label>
            {autopilot.lastRunAt && (
              <p className="mt-2 text-[11px] text-slate-400">Last run: {new Date(autopilot.lastRunAt).toLocaleString()}</p>
            )}
          </div>
          {costs.length > 0 && (
            <details className="mt-4 text-xs text-slate-500">
              <summary className="cursor-pointer font-medium text-slate-600">AI credit costs</summary>
              <ul className="mt-2 space-y-1">
                {costs.map((c) => (
                  <li key={c.feature} className="flex justify-between">
                    <span>{c.label}</span>
                    <span className="font-medium text-slate-700">{c.credits === 0 ? "free" : `${c.credits} cr`}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </form>

        {/* Brand kit — logo / phone / website / colors used in the branded design */}
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Brand kit</h2>
          <p className="mt-0.5 text-xs text-slate-500">Used to compose your branded post design.</p>
          <label className="mt-3 block text-xs font-medium text-slate-600">
            Logo URL
            <input value={brandKit.logoUrl ?? ""} onChange={(e) => setBrandKit((k) => ({ ...k, logoUrl: e.target.value }))} placeholder="https://…/logo.png" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="mt-2 block text-xs font-medium text-slate-600">
            Phone
            <input value={brandKit.phone ?? ""} onChange={(e) => setBrandKit((k) => ({ ...k, phone: e.target.value }))} placeholder="+91 98765 43210" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="mt-2 block text-xs font-medium text-slate-600">
            Website
            <input value={brandKit.website ?? ""} onChange={(e) => setBrandKit((k) => ({ ...k, website: e.target.value }))} placeholder="https://yoursite.com" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <p className="mt-3 text-xs font-medium text-slate-600">Color combo</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {palettes.map((p) => (
              <button
                key={p.key}
                type="button"
                title={p.label}
                onClick={() => setBrandKit((k) => ({ ...k, primaryColor: p.primary, secondaryColor: p.secondary }))}
                className={`h-7 w-7 overflow-hidden rounded-full border-2 ${brandKit.primaryColor === p.primary ? "border-slate-900" : "border-white"}`}
                style={{ background: `linear-gradient(135deg, ${p.primary} 50%, ${p.secondary} 50%)` }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Primary
              <input type="color" value={brandKit.primaryColor} onChange={(e) => setBrandKit((k) => ({ ...k, primaryColor: e.target.value }))} className="h-7 w-9 rounded border border-slate-300" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Secondary
              <input type="color" value={brandKit.secondaryColor} onChange={(e) => setBrandKit((k) => ({ ...k, secondaryColor: e.target.value }))} className="h-7 w-9 rounded border border-slate-300" />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void saveBrandKit()}
            disabled={savingKit}
            className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {savingKit ? "Saving…" : "Save brand kit"}
          </button>
        </div>
        </div>

        <div className="space-y-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Live branded preview</p>
          <GmbBrandedPreview
            kit={brandKit}
            businessName={businessName}
            caption={items[0]?.summary ?? ""}
            ctaType={items[0]?.callToActionType ?? (type === "OFFER" ? "ORDER" : "LEARN_MORE")}
          />
        </div>
        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No posts yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((p) => (
                <li key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{p.type}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.status === "PUBLISHED" ? "bg-emerald-50 text-emerald-700"
                          : p.status === "SCHEDULED" ? "bg-blue-50 text-blue-700"
                          : p.status === "FAILED" ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                        }`}>{p.status}</span>
                        {p.scheduledAt && (
                          <span className="text-xs text-slate-500">{new Date(p.scheduledAt).toLocaleString()}</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-800">{p.summary}</p>
                      {p.status === "FAILED" && p.error && (
                        <p className="mt-1.5 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{p.error}</p>
                      )}
                      {p.status === "PUBLISHED" && p.publishedAt && (
                        <p className="mt-1 text-xs text-emerald-600">Published {new Date(p.publishedAt).toLocaleString()}</p>
                      )}
                    </div>
                    <div className="flex flex-none gap-2">
                      {p.status === "PENDING_APPROVAL" && (
                        <>
                          <button onClick={() => void approve(p.id, false)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Approve</button>
                          <button onClick={() => void approve(p.id, true)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Approve + schedule</button>
                        </>
                      )}
                      {p.status !== "PUBLISHED" && p.status !== "PENDING_APPROVAL" && (
                        <button onClick={() => void publishNow(p.id)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
                          {p.status === "FAILED" ? "Retry" : "Publish now"}
                        </button>
                      )}
                      {p.status !== "PENDING_APPROVAL" && (
                        <button onClick={() => void schedule(p.id)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Schedule</button>
                      )}
                      <button onClick={() => void remove(p.id)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Delete</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>
      </div>
    </DashboardShell>
  );
}
