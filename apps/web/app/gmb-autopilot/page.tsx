"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Autopilot — configure the "auto-draft on a cadence, you approve" loop, see
// when it last ran and runs next, and run it on demand.
//
// Honesty notes carried from the backend:
//  - Nothing autopilot makes is published; posts land in the approval queue and
//    reply drafts stay unpublished until the operator approves. The page says so.
//  - Next-run is derived from lastRun + cadence and only fires if scheduled
//    workers are running on the platform; the manual "Run now" always works, so
//    the page leans on that as the reliable path.

interface Status {
  enabled: boolean;
  businessName: string;
  niche: string;
  tone: string;
  postsPerRun: number;
  cadenceHours: number;
  autoDraftReplies: boolean;
  replyTone: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  isDue: boolean;
  pendingPosts: number;
  pendingReplyDrafts: number;
}

const CADENCE_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 24, label: "Every day" },
  { hours: 72, label: "Every 3 days" },
  { hours: 168, label: "Weekly" },
  { hours: 336, label: "Every 2 weeks" },
  { hours: 720, label: "Monthly" },
];

function cadenceLabel(hours: number): string {
  return CADENCE_OPTIONS.find((o) => o.hours === hours)?.label ?? `Every ${hours}h`;
}

const inputCls =
  "rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 text-gmb-ink outline-none placeholder:text-gmb-ink-subtle focus:border-gmb-brand";

export default function GmbAutopilotPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form mirrors the config; seeded from the loaded status.
  const [form, setForm] = useState({
    enabled: false,
    businessName: "",
    niche: "general",
    tone: "friendly",
    postsPerRun: 3,
    cadenceHours: 168,
    autoDraftReplies: true,
    replyTone: "warm",
  });
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await api.get<Status>("/api/v1/gmb/autopilot/status");
      setStatus(s);
      setForm({
        enabled: s.enabled,
        businessName: s.businessName,
        niche: s.niche,
        tone: s.tone === "professional" ? "professional" : "friendly",
        postsPerRun: s.postsPerRun,
        cadenceHours: s.cadenceHours,
        autoDraftReplies: s.autoDraftReplies,
        replyTone: s.replyTone === "professional" ? "professional" : "warm",
      });
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load autopilot.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.put("/api/v1/gmb/autopilot", {
        enabled: form.enabled,
        businessName: form.businessName.trim(),
        niche: form.niche.trim() || "general",
        tone: form.tone,
        postsPerRun: form.postsPerRun,
        cadenceHours: form.cadenceHours,
        autoDraftReplies: form.autoDraftReplies,
        replyTone: form.replyTone,
      });
      setNotice("Autopilot settings saved.");
      await load();
    } catch (e2) {
      setError(e2 instanceof ApiClientError ? e2.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.post<{ postsDrafted: number; repliesDrafted: number; note?: string }>(
        "/api/v1/gmb/autopilot/run",
        {},
      );
      const bits = [`${r.postsDrafted} post draft${r.postsDrafted === 1 ? "" : "s"}`];
      if (r.repliesDrafted > 0) bits.push(`${r.repliesDrafted} reply draft${r.repliesDrafted === 1 ? "" : "s"}`);
      setNotice(`Autopilot ran — created ${bits.join(" and ")}. Review them in the approval queues.`);
      await load();
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : "Could not run autopilot. Is a business name set?",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <GmbShell title="Autopilot">
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && (
        <div className="mb-3.5 rounded-control border border-gmb-ok/30 bg-gmb-ok/10 px-3 py-2 text-sm2 text-gmb-ok">
          {notice}
        </div>
      )}

      {status === null ? (
        <div className="flex flex-col gap-3.5">
          <Skeleton className="h-[160px]" />
          <Skeleton className="h-[280px]" />
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {/* Status hero */}
          <div className="grid gap-3.5 lg:grid-cols-[1.3fr_1fr]">
            <div className="rounded-panel bg-gradient-to-br from-gmb-night to-gmb-night-deep p-6 text-white">
              <div className="flex items-center gap-2.5">
                <span className="font-geist-mono text-micro uppercase tracking-[0.1em] text-gmb-brand-border">
                  Autopilot
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-tiny font-semibold ${
                    status.enabled ? "bg-gmb-ok/25 text-white" : "bg-white/15 text-white/70"
                  }`}
                >
                  {status.enabled ? "On" : "Off"}
                </span>
              </div>
              <div className="mt-3 text-sm2 text-white/80">
                {status.enabled
                  ? `Drafts ${status.postsPerRun} post${status.postsPerRun === 1 ? "" : "s"} ${cadenceLabel(status.cadenceHours).toLowerCase()}${status.autoDraftReplies ? ", plus review replies" : ""} — for your approval.`
                  : "Turn it on to have posts and review replies drafted for you automatically. You still approve everything before it goes live."}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm2">
                <div>
                  <div className="text-micro uppercase tracking-wide text-gmb-brand-border">Last run</div>
                  <div className="mt-0.5 font-semibold text-white">
                    {status.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : "Never"}
                  </div>
                </div>
                <div>
                  <div className="text-micro uppercase tracking-wide text-gmb-brand-border">Next run</div>
                  <div className="mt-0.5 font-semibold text-white">
                    {!status.enabled
                      ? "—"
                      : status.isDue
                        ? "Due now"
                        : status.nextRunAt
                          ? new Date(status.nextRunAt).toLocaleString()
                          : "—"}
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => void runNow()}
                  disabled={running || !form.businessName.trim()}
                  className="rounded-control bg-white px-4 py-2 text-sm2 font-semibold text-gmb-night disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {running ? "Running…" : "Run autopilot now"}
                </button>
                {!form.businessName.trim() && (
                  <span className="ml-3 text-xs2 text-white/60">Set a business name below first.</span>
                )}
              </div>
            </div>

            <Card>
              <SectionLabel>Waiting for your approval</SectionLabel>
              <p className="mt-2 text-xs2 text-gmb-ink-muted">
                Autopilot never publishes. Its drafts land here for you to review.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <Link href="/gmb" className="no-underline hover:no-underline">
                  <div className="flex items-center justify-between rounded-control border border-gmb-line px-3.5 py-2.5 hover:border-gmb-brand-border">
                    <span className="text-sm2 text-gmb-ink">Post drafts</span>
                    <Pill tone={status.pendingPosts > 0 ? "warn" : "neutral"}>{status.pendingPosts}</Pill>
                  </div>
                </Link>
                <Link href="/gmb-reputation" className="no-underline hover:no-underline">
                  <div className="flex items-center justify-between rounded-control border border-gmb-line px-3.5 py-2.5 hover:border-gmb-brand-border">
                    <span className="text-sm2 text-gmb-ink">Reply drafts</span>
                    <Pill tone={status.pendingReplyDrafts > 0 ? "warn" : "neutral"}>
                      {status.pendingReplyDrafts}
                    </Pill>
                  </div>
                </Link>
              </div>
            </Card>
          </div>

          {/* Settings */}
          <Card>
            <SectionLabel>Settings</SectionLabel>
            <form onSubmit={save} className="mt-3 grid gap-3.5 md:grid-cols-2">
              <label className="flex items-center gap-2.5 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                <span className="text-sm2 font-semibold text-gmb-ink">
                  Run autopilot automatically on a schedule
                </span>
              </label>

              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Business name</span>
                <input
                  value={form.businessName}
                  onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                  placeholder="e.g. Demo Salon"
                  required
                  className={inputCls}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Niche</span>
                <input
                  value={form.niche}
                  onChange={(e) => setForm({ ...form, niche: e.target.value })}
                  placeholder="general"
                  className={inputCls}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Post tone</span>
                <select value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} className={inputCls}>
                  <option value="friendly">Friendly</option>
                  <option value="professional">Professional</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Posts per run</span>
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={form.postsPerRun}
                  onChange={(e) => setForm({ ...form, postsPerRun: Math.max(1, Math.min(14, Number(e.target.value) || 1)) })}
                  className={inputCls}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Cadence</span>
                <select
                  value={form.cadenceHours}
                  onChange={(e) => setForm({ ...form, cadenceHours: Number(e.target.value) })}
                  className={inputCls}
                >
                  {CADENCE_OPTIONS.map((o) => (
                    <option key={o.hours} value={o.hours}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2.5 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.autoDraftReplies}
                  onChange={(e) => setForm({ ...form, autoDraftReplies: e.target.checked })}
                />
                <span className="text-sm2 text-gmb-ink">Also draft replies to new reviews</span>
              </label>

              {form.autoDraftReplies && (
                <label className="flex flex-col gap-1">
                  <span className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Reply tone</span>
                  <select value={form.replyTone} onChange={(e) => setForm({ ...form, replyTone: e.target.value })} className={inputCls}>
                    <option value="warm">Warm</option>
                    <option value="professional">Professional</option>
                  </select>
                </label>
              )}

              <div className="flex items-end justify-end md:col-span-2">
                <Button type="submit" disabled={saving || !form.businessName.trim()}>
                  {saving ? "Saving…" : "Save settings"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </GmbShell>
  );
}
