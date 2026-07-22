"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Insights — Google Business Profile performance (views, searches, actions).
//
// Google only exposes these numbers to a connected profile, so before any sync
// there is genuinely nothing to show. The screen says that plainly rather than
// rendering a wall of zeros that looks like real, terrible performance. The
// period-over-period deltas come straight from the API's comparison against
// the previous equal-length window.

interface Delta {
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

interface Summary {
  totalViews: number;
  totalSearches: number;
  totalActions: number;
  actionRate: number;
  periods: number;
  rangeStart: string | null;
  rangeEnd: string | null;
  mapsViews: number;
  searchViews: number;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  messageClicks: number;
  bookingClicks: number;
  photoViews: number;
  comparison: {
    totalViews: Delta;
    totalSearches: Delta;
    totalActions: Delta;
    actionRate: Delta;
  } | null;
}

interface LocationLite {
  id: string;
  name: string;
}

function num(n: number): string {
  return n.toLocaleString();
}

function DeltaTag({ d, suffix = "" }: { d: Delta | undefined; suffix?: string }) {
  if (!d || d.previous === 0) {
    return <span className="font-geist-mono text-micro text-gmb-ink-subtle">no prior period</span>;
  }
  const up = d.change >= 0;
  return (
    <span
      className={`font-geist-mono text-micro font-semibold ${up ? "text-gmb-ok" : "text-gmb-danger"}`}
    >
      {up ? "▲" : "▼"} {Math.abs(d.changePercent)}%{suffix}
    </span>
  );
}

export default function GmbInsightsPage() {
  const [locations, setLocations] = useState<LocationLite[]>([]);
  const [locationId, setLocationId] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    if (!locationId) return;
    setLoading(true);
    setError(null);
    try {
      setSummary(
        await api.get<Summary>(`/api/v1/gmb/insights/summary?locationId=${locationId}`),
      );
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load insights.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasData = summary && summary.periods > 0;

  return (
    <GmbShell title="Insights">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className="mb-3.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionLabel>How customers find you on Google</SectionLabel>
            <div className="mt-1 text-sm2 text-gmb-ink-muted">
              {hasData && summary.rangeStart
                ? `${summary.periods} period${summary.periods === 1 ? "" : "s"} · ${new Date(
                    summary.rangeStart,
                  ).toLocaleDateString()} – ${new Date(summary.rangeEnd!).toLocaleDateString()}`
                : "Views, searches and actions pulled from your Business Profile."}
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
            <Button variant="ghost" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="grid grid-cols-4 gap-3.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : !hasData ? (
        <EmptyState
          title="No performance data yet"
          body="Google shares views, searches and customer actions only for a connected profile. Connect Google and the first sync will populate this — until then there is genuinely nothing to measure."
        />
      ) : (
        <div className="flex flex-col gap-3.5">
          {/* Headline four */}
          <div className="grid grid-cols-4 gap-3.5">
            {(
              [
                ["Profile views", summary.totalViews, summary.comparison?.totalViews],
                ["Searches", summary.totalSearches, summary.comparison?.totalSearches],
                ["Customer actions", summary.totalActions, summary.comparison?.totalActions],
              ] as const
            ).map(([label, value, d]) => (
              <Card key={label}>
                <SectionLabel>{label}</SectionLabel>
                <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">{num(value)}</div>
                <div className="mt-1">
                  <DeltaTag d={d} />
                </div>
              </Card>
            ))}
            <Card>
              <SectionLabel>Action rate</SectionLabel>
              <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
                {(summary.actionRate * 100).toFixed(1)}%
              </div>
              <div className="mt-1">
                <DeltaTag d={summary.comparison?.actionRate} suffix=" pts" />
              </div>
            </Card>
          </div>

          {/* Where views come from */}
          <div className="grid gap-3.5 lg:grid-cols-2">
            <Card>
              <SectionLabel>Where views come from</SectionLabel>
              <div className="mt-3 flex flex-col gap-2.5">
                {(
                  [
                    ["Google Maps", summary.mapsViews],
                    ["Google Search", summary.searchViews],
                    ["Photo views", summary.photoViews],
                  ] as const
                ).map(([label, value]) => {
                  const share = summary.totalViews > 0 ? value / summary.totalViews : 0;
                  return (
                    <div key={label}>
                      <div className="flex items-center justify-between text-xs2">
                        <span className="text-gmb-ink">{label}</span>
                        <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                          {num(value)}
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
            </Card>

            <Card>
              <SectionLabel>What customers did</SectionLabel>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {(
                  [
                    ["Calls", summary.callClicks],
                    ["Website clicks", summary.websiteClicks],
                    ["Directions", summary.directionRequests],
                    ["Messages", summary.messageClicks],
                    ["Bookings", summary.bookingClicks],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-control border border-gmb-line bg-gmb-subtle px-3 py-2.5"
                  >
                    <div className="text-xl font-bold tracking-[-0.02em]">{num(value)}</div>
                    <div className="mt-0.5 text-micro uppercase tracking-wide text-gmb-ink-subtle">
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </GmbShell>
  );
}
