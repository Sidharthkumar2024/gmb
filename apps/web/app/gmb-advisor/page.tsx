"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Advisor — the prioritised weekly to-do list.
//
// The score is only useful if you can see what is dragging it down, so the
// breakdown shows points earned against points available per area rather than
// a bare number. Focus areas come from the API already ranked by recoverable
// points, so the top item is genuinely the biggest win, not the first
// alphabetically.

interface ScoreArea {
  area: string;
  points: number;
  weight: number;
}

interface Task {
  priority: "high" | "medium" | "low";
  area: string;
  task: string;
}

interface Advisor {
  id: string;
  locationId: string;
  score: number;
  grade: string;
  breakdown: ScoreArea[];
  tasks: Task[];
  summary: string | null;
  focusAreas: Array<{ area: string; recoverable: number }>;
  createdAt: string;
}

interface LocationLite {
  id: string;
  name: string;
}

const PRIORITY_TONE = { high: "danger", medium: "warn", low: "neutral" } as const;

function gradeTone(grade: string): string {
  if (grade.startsWith("A")) return "text-gmb-ok";
  if (grade.startsWith("B") || grade.startsWith("C")) return "text-gmb-warn";
  return "text-gmb-danger";
}

function titleCase(s: string): string {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function GmbAdvisorPage() {
  const [locations, setLocations] = useState<LocationLite[]>([]);
  const [locationId, setLocationId] = useState("");
  const [latest, setLatest] = useState<Advisor | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
      const rows = await api.get<Advisor[]>(`/api/v1/gmb/advisor?locationId=${locationId}`);
      setLatest(rows?.[0] ?? null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load advisor reports.");
      setLatest(null);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/gmb/advisor", { locationId });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not run the advisor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GmbShell title="Advisor">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className="mb-3.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionLabel>This week&rsquo;s moves</SectionLabel>
            <div className="mt-1 max-w-xl text-sm2 text-gmb-ink-muted">
              The advisor reads your profile, reviews, posts, rankings and citations, then ranks
              what to fix by how many score points it would recover.
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
            <Button variant="dark" disabled={busy || !locationId} onClick={() => void run()}>
              {busy ? "Analysing…" : latest ? "Re-run advisor" : "Run advisor"}
            </Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Skeleton className="h-64" />
      ) : !latest ? (
        <EmptyState
          title="No advisor run yet"
          body="Run the advisor to get a visibility score and a ranked list of the fixes that would move it most."
          action={
            <Button variant="dark" disabled={!locationId} onClick={() => void run()}>
              Run advisor
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          {/* Score + breakdown */}
          <div className="flex flex-col gap-3.5">
            <div className="rounded-panel bg-gradient-to-br from-gmb-night to-gmb-night-deep p-6 text-white">
              <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-gmb-brand-border">
                Visibility score
              </div>
              <div className="mt-1 flex items-end gap-3">
                <div className="text-[42px] font-bold leading-none tracking-[-0.025em]">
                  {latest.score}
                </div>
                <div className="mb-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-tiny font-semibold">
                  Grade {latest.grade}
                </div>
              </div>
              {latest.summary && (
                <p className="mt-3 text-sm2 leading-relaxed text-white/75">{latest.summary}</p>
              )}
              <div className="mt-3 font-geist-mono text-micro text-white/50">
                run {new Date(latest.createdAt).toLocaleString()}
              </div>
            </div>

            <Card>
              <SectionLabel>Where the points are</SectionLabel>
              <div className="mt-3 flex flex-col gap-2.5">
                {(latest.breakdown ?? []).map((b) => {
                  const share = b.weight > 0 ? b.points / b.weight : 0;
                  return (
                    <div key={b.area}>
                      <div className="flex items-center justify-between text-xs2">
                        <span className="font-medium text-gmb-ink">{titleCase(b.area)}</span>
                        <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                          {b.points}/{b.weight}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gmb-line-soft">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round(share * 100)}%`,
                            background:
                              share >= 0.8 ? "#22c55e" : share >= 0.5 ? "#f59e0b" : "#f04438",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Tasks */}
          <div className="flex flex-col gap-3.5">
            {latest.focusAreas?.length > 0 && (
              <Card>
                <SectionLabel>Biggest opportunities</SectionLabel>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {latest.focusAreas.slice(0, 4).map((f) => (
                    <span
                      key={f.area}
                      className="rounded-full border border-gmb-brand-border bg-gmb-brand-wash px-3 py-1 text-xs2 font-semibold text-gmb-brand"
                    >
                      {titleCase(f.area)}
                      <span className="ml-1.5 font-geist-mono opacity-70">
                        +{f.recoverable} pts
                      </span>
                    </span>
                  ))}
                </div>
              </Card>
            )}

            <Card>
              <SectionLabel>Do these next</SectionLabel>
              {(latest.tasks ?? []).length === 0 ? (
                <div className="mt-3 text-sm2 text-gmb-ink-muted">
                  Nothing outstanding — your profile is in good shape.
                </div>
              ) : (
                <ol className="mt-3 flex list-none flex-col gap-2 p-0">
                  {(latest.tasks ?? []).map((t, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-control border border-gmb-line p-3"
                    >
                      <Pill tone={PRIORITY_TONE[t.priority] ?? "neutral"}>{t.priority}</Pill>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm2 leading-snug text-gmb-ink">{t.task}</div>
                        <div className="mt-0.5 font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle">
                          {titleCase(t.area)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </div>
      )}
    </GmbShell>
  );
}
