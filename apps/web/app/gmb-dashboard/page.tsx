"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GmbShell, useActiveLocationId } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Stat, Pill, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Dashboard — the GMB Suite landing screen.
//
// Every figure comes from GET /api/v1/gmb/dashboard. Where the API has no
// value (no advisor run, no keywords tracked) the tile says so rather than
// rendering a zero: "0" and "not measured yet" mean very different things to
// someone deciding what to fix next.

interface DashboardData {
  businessScore: number | null;
  grade: string | null;
  locations: { total: number; connected: number };
  reviews: { count: number; average: number; unanswered: number };
  ranking: { trackedKeywords: number; top3: number; top10: number; notFound: number };
  citations: { total: number; consistent: number; consistencyScore: number };
  posts: { recent: number; total: number };
  credits: number | null;
  advisor: { score: number; grade: string; at: string } | null;
  alerts: Array<{ severity: string; message: string }>;
  generatedAt: string;
}

const SEVERITY_TONE: Record<string, "danger" | "warn" | "neutral"> = {
  high: "danger",
  medium: "warn",
  low: "neutral",
};

export default function GmbDashboardPage() {
  const locationId = useActiveLocationId();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = locationId ? `?locationId=${locationId}` : "";
    void api
      .get<DashboardData>(`/api/v1/gmb/dashboard${qs}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof ApiClientError ? e.message : "Could not load the dashboard.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  return (
    <GmbShell title="Dashboard">
      {error && <ErrorNote>{error}</ErrorNote>}

      {loading && !data ? (
        <div className="grid grid-cols-4 gap-3.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : data ? (
        <div className="flex flex-col gap-3.5">
          {/* Hero: score + next actions */}
          <div className="grid grid-cols-[1.3fr_1fr] items-start gap-3.5">
            <div className="rounded-panel bg-gradient-to-br from-gmb-night to-gmb-night-deep p-6 text-white">
              <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-gmb-brand-border">
                Visibility score
              </div>
              <div className="mt-1 flex items-end gap-3">
                <div className="text-[42px] font-bold leading-none tracking-[-0.025em]">
                  {data.businessScore ?? "—"}
                </div>
                {data.grade && (
                  <div className="mb-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-tiny font-semibold">
                    Grade {data.grade}
                  </div>
                )}
              </div>
              <div className="mt-2 text-sm2 text-white/70">
                {data.advisor
                  ? `Last advisor run ${new Date(data.advisor.at).toLocaleDateString()}`
                  : "No advisor run yet — run one to get a score and a fix list."}
              </div>
              <div className="mt-4 flex gap-2">
                <Link href="/gmb-advisor" className="no-underline hover:no-underline">
                  <span className="inline-block rounded-control bg-white px-4 py-2 text-sm2 font-semibold text-gmb-night">
                    {data.advisor ? "See this week's moves" : "Run the advisor"}
                  </span>
                </Link>
                <Link href="/gmb-ranking" className="no-underline hover:no-underline">
                  <span className="inline-block rounded-control border border-white/25 px-4 py-2 text-sm2 font-semibold text-white">
                    Open rank tracker
                  </span>
                </Link>
              </div>
            </div>

            <Card>
              <SectionLabel>Risk watch</SectionLabel>
              {data.alerts.length === 0 ? (
                <div className="mt-3 text-sm2 text-gmb-ink-muted">
                  Nothing needs attention right now.
                </div>
              ) : (
                <ul className="mt-3 flex list-none flex-col gap-2.5 p-0">
                  {data.alerts.slice(0, 5).map((a, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <Pill tone={SEVERITY_TONE[a.severity] ?? "neutral"}>{a.severity}</Pill>
                      <span className="text-sm2 leading-snug text-gmb-ink-muted">{a.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Tiles */}
          <div className="grid grid-cols-4 gap-3.5">
            <Stat
              label="Locations"
              value={data.locations.total}
              caption={`${data.locations.connected} connected to Google`}
            />
            <Stat
              label="Reviews"
              value={data.reviews.count}
              caption={
                data.reviews.count > 0
                  ? `${data.reviews.average.toFixed(1)} average rating`
                  : "No reviews synced yet"
              }
            />
            <Stat
              label="Reply queue"
              value={data.reviews.unanswered}
              tone={data.reviews.unanswered > 0 ? "warn" : "ok"}
              caption={data.reviews.unanswered > 0 ? "awaiting a reply" : "all clear"}
            />
            <Stat
              label="Posts (30d)"
              value={data.posts.recent}
              caption={`${data.posts.total} total`}
            />
          </div>

          <div className="grid grid-cols-3 gap-3.5">
            <Card>
              <SectionLabel>Rank tracker</SectionLabel>
              {data.ranking.trackedKeywords === 0 ? (
                <div className="mt-3 text-sm2 text-gmb-ink-muted">
                  No keywords tracked yet.{" "}
                  <Link href="/gmb-ranking" className="font-semibold text-gmb-brand">
                    Add some →
                  </Link>
                </div>
              ) : (
                <div className="mt-3 flex items-baseline gap-5">
                  <div>
                    <div className="text-2xl font-bold text-gmb-ok">{data.ranking.top3}</div>
                    <div className="text-micro uppercase tracking-wide text-gmb-ink-subtle">
                      top 3
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{data.ranking.top10}</div>
                    <div className="text-micro uppercase tracking-wide text-gmb-ink-subtle">
                      top 10
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gmb-ink-subtle">
                      {data.ranking.notFound}
                    </div>
                    <div className="text-micro uppercase tracking-wide text-gmb-ink-subtle">
                      not found
                    </div>
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <SectionLabel>Citations</SectionLabel>
              {data.citations.total === 0 ? (
                <div className="mt-3 text-sm2 text-gmb-ink-muted">No citation scan yet.</div>
              ) : (
                <>
                  <div className="mt-3 text-2xl font-bold">
                    {data.citations.consistencyScore}
                    <span className="text-sm font-medium text-gmb-ink-subtle">%</span>
                  </div>
                  <div className="mt-1 text-xs2 text-gmb-ink-muted">
                    {data.citations.consistent} of {data.citations.total} listings consistent
                  </div>
                </>
              )}
            </Card>

            <Card>
              <SectionLabel>Credits</SectionLabel>
              <div className="mt-3 text-2xl font-bold">
                {data.credits === null ? "—" : data.credits.toLocaleString()}
              </div>
              <div className="mt-1 text-xs2 text-gmb-ink-muted">
                {data.credits === null ? "Billing is not enabled" : "AI credits remaining"}
              </div>
            </Card>
          </div>

          <div className="text-right font-geist-mono text-micro text-gmb-ink-subtle">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </div>
      ) : null}
    </GmbShell>
  );
}
