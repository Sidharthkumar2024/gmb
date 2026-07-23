"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";
import { resolveApiBase } from "../../src/lib/apiBase";

// Reports — periodic snapshots of the whole profile (reviews, insights,
// rankings, citations, posts) with a generated summary and action plan.
//
// A report is a point-in-time record, so once generated it never changes —
// the list is history. Generating one runs the same aggregations the dashboard
// uses, then freezes them, so a report and the live dashboard can differ (and
// that is correct: the report is what things looked like then).

type ReportType = "WEEKLY" | "MONTHLY" | "CUSTOM";

interface ReportData {
  reviews?: { count: number; average: number; unanswered: number };
  insights?: { totalViews: number; totalActions: number; actionRate: number };
  citations?: { total: number; consistent: number };
  ranking?: { trackedKeywords?: number; top3?: number };
  posts?: { created: number };
}

interface Report {
  id: string;
  locationId: string | null;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  data: ReportData;
  summary: string | null;
  actionPlan: Array<{ priority?: string; task?: string }> | null;
  createdAt: string;
}

interface LocationLite {
  id: string;
  name: string;
}

interface ReportSchedule {
  enabled: boolean;
  frequency: "WEEKLY" | "MONTHLY" | "CUSTOM";
  lastRunAt: string | null;
}

const PRIORITY_TONE: Record<string, "danger" | "warn" | "neutral"> = {
  high: "danger",
  medium: "warn",
  low: "neutral",
};

function isoRange(days: number): { periodStart: string; periodEnd: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

export default function GmbReportsPage() {
  const [locations, setLocations] = useState<LocationLite[]>([]);
  const [locationId, setLocationId] = useState("");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [type, setType] = useState<ReportType>("MONTHLY");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ReportSchedule | null>(null);
  const [schedBusy, setSchedBusy] = useState(false);

  useEffect(() => {
    void api
      .get<ReportSchedule>("/api/v1/gmb/report-schedule")
      .then(setSchedule)
      .catch(() => undefined);
  }, []);

  // Persist an enable/frequency change immediately — one toggle, one save, so
  // there is no separate "save schedule" button to forget.
  async function saveSchedule(next: { enabled: boolean; frequency: "WEEKLY" | "MONTHLY" }) {
    setSchedBusy(true);
    setError(null);
    try {
      setSchedule(await api.put<ReportSchedule>("/api/v1/gmb/report-schedule", next));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update the schedule.");
    } finally {
      setSchedBusy(false);
    }
  }

  useEffect(() => {
    void api
      .get<LocationLite[]>("/api/v1/gmb/locations")
      .then((rows) => {
        setLocations(rows ?? []);
        const saved = window.localStorage.getItem("gmb_active_location");
        setLocationId(rows?.some((r) => r.id === saved) ? saved! : (rows?.[0]?.id ?? ""));
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = locationId ? `?locationId=${locationId}` : "";
      const rows = await api.get<Report[]>(`/api/v1/gmb/reports${qs}`);
      setReports(rows ?? []);
      setOpenId((cur) => cur ?? rows?.[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load reports.");
      setReports([]);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy("generate");
    setError(null);
    try {
      const range = isoRange(type === "WEEKLY" ? 7 : 30);
      const created = await api.post<Report>("/api/v1/gmb/reports/generate", {
        ...(locationId ? { locationId } : {}),
        type,
        ...range,
      });
      setOpenId(created.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not generate the report.");
    } finally {
      setBusy(null);
    }
  }

  // The PDF endpoint sits behind the same auth as everything else, so a bare
  // <a href> would 401. Fetch it with the token, then open the blob.
  async function openPdf(id: string) {
    setBusy(`pdf-${id}`);
    setError(null);
    try {
      const token = window.localStorage.getItem("nx_access");
      const res = await fetch(`${resolveApiBase()}/api/v1/gmb/reports/${id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`PDF request failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank", "noopener");
      // Give the new tab a moment to grab the blob before revoking it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await api.delete(`/api/v1/gmb/reports/${id}`);
      if (openId === id) setOpenId(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not delete the report.");
    } finally {
      setBusy(null);
    }
  }

  const open = (reports ?? []).find((r) => r.id === openId) ?? null;

  return (
    <GmbShell title="Reports">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className="mb-3.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionLabel>Generate a report</SectionLabel>
            <div className="mt-1 text-sm2 text-gmb-ink-muted">
              A frozen snapshot of reviews, performance, rankings and citations for the period,
              with a plain-language summary and next steps.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {locations.length > 1 && (
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 outline-none"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ReportType)}
              className="rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 outline-none"
            >
              <option value="WEEKLY">Last 7 days</option>
              <option value="MONTHLY">Last 30 days</option>
            </select>
            <Button variant="dark" disabled={busy === "generate"} onClick={() => void generate()}>
              {busy === "generate" ? "Generating…" : "Generate"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Scheduled reports — the same generation, run automatically on a cadence
          and (once SMTP is configured) emailed out. Backed by /report-schedule. */}
      <Card className="mb-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionLabel>Scheduled reports</SectionLabel>
            <div className="mt-1 text-sm2 text-gmb-ink-muted">
              {schedule?.enabled
                ? `A ${schedule.frequency === "WEEKLY" ? "weekly" : "monthly"} report is generated automatically for this workspace.`
                : "Generate a report automatically on a schedule instead of by hand."}
            </div>
            {schedule?.lastRunAt && (
              <div className="mt-1 font-geist-mono text-micro text-gmb-ink-subtle">
                Last scheduled run {new Date(schedule.lastRunAt).toLocaleString()}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {schedule === null ? (
              <Skeleton className="h-9 w-40" />
            ) : (
              <>
                <select
                  value={schedule.frequency === "WEEKLY" ? "WEEKLY" : "MONTHLY"}
                  disabled={schedBusy}
                  onChange={(e) =>
                    void saveSchedule({
                      enabled: schedule.enabled,
                      frequency: e.target.value as "WEEKLY" | "MONTHLY",
                    })
                  }
                  className="rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 outline-none disabled:opacity-50"
                >
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
                <Button
                  variant={schedule.enabled ? "ghost" : "primary"}
                  disabled={schedBusy}
                  onClick={() =>
                    void saveSchedule({
                      enabled: !schedule.enabled,
                      frequency: schedule.frequency === "WEEKLY" ? "WEEKLY" : "MONTHLY",
                    })
                  }
                >
                  {schedBusy ? "Saving…" : schedule.enabled ? "Turn off" : "Turn on"}
                </Button>
              </>
            )}
          </div>
        </div>
        {schedule?.enabled && (
          <div className="mt-3 flex items-center gap-2 border-t border-gmb-line pt-3">
            <Pill tone="ok">On</Pill>
            <span className="text-xs2 text-gmb-ink-muted">
              Reports are saved to the history below. Email delivery is sent when the platform has
              SMTP configured.
            </span>
          </div>
        )}
      </Card>

      {reports === null ? (
        <Skeleton className="h-64" />
      ) : reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          body="Generate your first report to capture where the profile stands today — then each new one shows the trend since the last."
        />
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-[280px_1fr] lg:items-start">
          {/* History list */}
          <div className="flex flex-col gap-2">
            {reports.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpenId(r.id)}
                className={`rounded-card border px-4 py-3 text-left transition ${
                  openId === r.id
                    ? "border-gmb-brand bg-gmb-brand-wash"
                    : "border-gmb-line bg-gmb-surface hover:border-gmb-brand-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Pill tone="brand">{r.type}</Pill>
                  <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-1.5 text-xs2 text-gmb-ink-muted">
                  {new Date(r.periodStart).toLocaleDateString()} –{" "}
                  {new Date(r.periodEnd).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>

          {/* Detail */}
          {open && (
            <div className="flex flex-col gap-3.5">
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <SectionLabel>
                      {open.type} report ·{" "}
                      {new Date(open.periodStart).toLocaleDateString()} –{" "}
                      {new Date(open.periodEnd).toLocaleDateString()}
                    </SectionLabel>
                    {open.summary && (
                      <p className="mt-2 max-w-2xl text-sm2 leading-relaxed text-gmb-ink">
                        {open.summary}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      variant="ghost"
                      disabled={busy === `pdf-${open.id}`}
                      onClick={() => void openPdf(open.id)}
                    >
                      {busy === `pdf-${open.id}` ? "Opening…" : "PDF ↗"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy === open.id}
                      onClick={() => void remove(open.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Metric grid */}
              <div className="grid grid-cols-3 gap-3.5">
                {(
                  [
                    ["Reviews", open.data.reviews?.count, open.data.reviews ? `${open.data.reviews.average.toFixed(1)}★ avg` : ""],
                    ["Profile views", open.data.insights?.totalViews, open.data.insights ? `${((open.data.insights.actionRate ?? 0) * 100).toFixed(1)}% acted` : ""],
                    ["Customer actions", open.data.insights?.totalActions, ""],
                    ["Keywords in top 3", open.data.ranking?.top3, open.data.ranking?.trackedKeywords ? `of ${open.data.ranking.trackedKeywords} tracked` : ""],
                    ["Consistent citations", open.data.citations?.consistent, open.data.citations ? `of ${open.data.citations.total}` : ""],
                    ["Posts published", open.data.posts?.created, ""],
                  ] as const
                ).map(([label, value, caption]) => (
                  <Card key={label}>
                    <SectionLabel>{label}</SectionLabel>
                    <div className="mt-1.5 text-2xl font-bold tracking-[-0.02em]">
                      {typeof value === "number" ? value.toLocaleString() : "—"}
                    </div>
                    {caption && <div className="mt-1 text-micro text-gmb-ink-subtle">{caption}</div>}
                  </Card>
                ))}
              </div>

              {/* Action plan */}
              {open.actionPlan && open.actionPlan.length > 0 && (
                <Card>
                  <SectionLabel>Recommended next steps</SectionLabel>
                  <ol className="mt-3 flex list-none flex-col gap-2 p-0">
                    {open.actionPlan.map((a, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <Pill tone={PRIORITY_TONE[(a.priority ?? "low").toLowerCase()] ?? "neutral"}>
                          {a.priority ?? "low"}
                        </Pill>
                        <span className="text-sm2 leading-snug text-gmb-ink">{a.task}</span>
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </GmbShell>
  );
}
