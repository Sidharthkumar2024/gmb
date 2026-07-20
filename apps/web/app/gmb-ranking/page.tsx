"use client";

// AdGrowly — Ranking tracker (planning PDF §2/§3). Combines the AI Keyword
// Finder (module 10) with the local-ranking tracker (module 3): generate
// keyword ideas, track them, record rank checks and view the trend.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { GmbLocationSwitcher } from "../../src/components/GmbLocationSwitcher";
import { useAuth } from "../../src/hooks/useAuth";
import { useGmbLocation } from "../../src/hooks/useGmbLocation";
import { api, ApiClientError } from "../../src/lib/api";

interface KeywordIdea {
  keyword: string;
  kind: string;
  score: number;
}

interface KeywordCluster {
  kind: string;
  count: number;
  topKeywords: string[];
}

interface Keyword {
  id: string;
  keyword: string;
  isActive: boolean;
  latestRank?: number | null;
  bucket?: string | null;
  lastCheckedAt?: string | null;
}

interface Snapshot {
  id: string;
  rank: number | null;
  bucket: string;
  checkedAt: string;
}

interface Trend {
  latest: number | null;
  previous: number | null;
  delta: number | null;
  best: number | null;
  average: number | null;
  checks: number;
  bucket: string;
}

// Grid rank tracker (Adgrowly GMB Panel design).
interface GridPoint {
  lat: number;
  lng: number;
  rank: number | null;
}
interface GridResult {
  snapshotId: string;
  gridSize: number;
  radiusKm: number;
  points: GridPoint[];
  stats: { avgRank: number | null; top3Share: number; foundShare: number };
  /** Ordered local results at the grid's centre point ("Local leaderboard"). */
  leaderboard?: Array<{ rank: number; name: string; isYou: boolean }>;
  /** Per-rival heat-maps over the same lattice ("Competitor battle map").
   *  `ranks` is index-aligned with `points`. */
  battleMap?: {
    rivals: Array<{
      name: string;
      ranks: Array<number | null>;
      avgRank: number | null;
      foundShare: number;
    }>;
  };
  capturedAt: string;
}

function gridCellClass(rank: number | null): string {
  if (rank == null) return "bg-slate-200 text-slate-400";
  if (rank <= 3) return "bg-emerald-500 text-white";
  if (rank <= 7) return "bg-amber-500 text-white";
  return "bg-red-500 text-white";
}

interface KeywordDetail extends Keyword {
  trend: Trend;
  snapshots: Snapshot[];
}

// Rank-drop alert rule (Adgrowly GMB Panel design — "Create alert rule").
interface AlertRule {
  id: string;
  thresholdRank: number;
  notifyEmail: string | null;
  isActive: boolean;
  lastTriggeredAt: string | null;
  lastTriggeredRank: number | null;
  keyword: { id: string; keyword: string; locationId: string };
}

const BUCKET_STYLES: Record<string, string> = {
  top3: "bg-emerald-50 text-emerald-700 border-emerald-200",
  top10: "bg-amber-50 text-amber-700 border-amber-200",
  beyond: "bg-slate-100 text-slate-600 border-slate-200",
  not_found: "bg-red-50 text-red-700 border-red-200",
};

export default function GmbRankingPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [locationId] = useGmbLocation();
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [services, setServices] = useState("");
  const [ideas, setIdeas] = useState<KeywordIdea[]>([]);
  const [clusters, setClusters] = useState<KeywordCluster[]>([]);
  const [ideaSource, setIdeaSource] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [detail, setDetail] = useState<Record<string, KeywordDetail>>({});
  const [rankInputs, setRankInputs] = useState<Record<string, string>>({});
  const [grids, setGrids] = useState<Record<string, GridResult | null>>({});
  const [gridBusy, setGridBusy] = useState<string | null>(null);
  /** Competitor battle map: which rival's heat-map is shown per keyword.
   *  null / absent = show our own ranks (the default view). */
  const [battleView, setBattleView] = useState<Record<string, string | null>>({});
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Rank-drop alert rules (Adgrowly GMB Panel design — "Create alert rule").
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertKeywordId, setAlertKeywordId] = useState("");
  const [alertThreshold, setAlertThreshold] = useState("10");
  const [alertEmail, setAlertEmail] = useState("");
  const [alertBusy, setAlertBusy] = useState(false);

  async function refreshAlertRules() {
    try {
      setAlertRules(await api.get<AlertRule[]>("/api/v1/gmb/rank-alerts"));
    } catch {
      /* non-blocking — the ranking page still works without rules */
    }
  }

  async function createAlertRule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!alertKeywordId || alertBusy) return;
    setAlertBusy(true);
    setErr(null);
    try {
      await api.post("/api/v1/gmb/rank-alerts", {
        keywordId: alertKeywordId,
        thresholdRank: Number(alertThreshold) || 10,
        notifyEmail: alertEmail.trim() || null,
      });
      setAlertEmail("");
      setNotice("Alert rule created — you'll be notified when the rank drops past the threshold.");
      await refreshAlertRules();
    } catch (e2) {
      setErr(e2 instanceof ApiClientError ? e2.message : "Could not create the alert rule.");
    } finally {
      setAlertBusy(false);
    }
  }

  async function toggleAlertRule(rule: AlertRule) {
    try {
      await api.patch(`/api/v1/gmb/rank-alerts/${rule.id}`, { isActive: !rule.isActive });
      await refreshAlertRules();
    } catch (e2) {
      setErr(e2 instanceof ApiClientError ? e2.message : "Could not update the rule.");
    }
  }

  async function removeAlertRule(id: string) {
    try {
      await api.delete(`/api/v1/gmb/rank-alerts/${id}`);
      await refreshAlertRules();
    } catch (e2) {
      setErr(e2 instanceof ApiClientError ? e2.message : "Could not delete the rule.");
    }
  }

  async function refreshKeywords() {
    try {
      setErr(null);
      const q = locationId.trim() ? `?locationId=${encodeURIComponent(locationId.trim())}` : "";
      setKeywords(await api.get<Keyword[]>(`/api/v1/gmb/keywords${q}`));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load keywords.");
    }
  }

  useEffect(() => {
    if (user) {
      void refreshKeywords();
      void refreshAlertRules();
    }
    // Reload when the shared location selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, locationId]);

  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      const res = await api.post<{ ideas: KeywordIdea[]; clusters?: KeywordCluster[]; source?: string }>(
        "/api/v1/gmb/keyword-ideas/generate",
        {
          category: category.trim() || undefined,
          city: city.trim() || undefined,
          services: services.split(",").map((s) => s.trim()).filter(Boolean),
        },
      );
      setIdeas(res.ideas);
      setClusters(res.clusters ?? []);
      setIdeaSource(res.source ?? null);
      if (res.ideas.length === 0) setNotice("Add a category or service to generate ideas.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to generate ideas.");
    }
  }

  async function track(keyword: string) {
    if (!locationId.trim()) {
      setErr("Enter a Location ID to track keywords.");
      return;
    }
    setErr(null);
    try {
      await api.post("/api/v1/gmb/keywords", { locationId: locationId.trim(), keyword });
      setNotice(`Tracking "${keyword}".`);
      await refreshKeywords();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to track keyword.");
    }
  }

  async function loadTrend(id: string) {
    try {
      setDetail((d) => ({ ...d, [id]: undefined as unknown as KeywordDetail }));
      const res = await api.get<KeywordDetail>(`/api/v1/gmb/keywords/${id}`);
      setDetail((d) => ({ ...d, [id]: res }));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load trend.");
    }
  }

  async function recordRank(id: string) {
    const raw = (rankInputs[id] ?? "").trim();
    const rank = raw === "" ? null : Number(raw);
    setErr(null);
    try {
      await api.post(`/api/v1/gmb/keywords/${id}/snapshots`, { rank });
      setRankInputs((r) => ({ ...r, [id]: "" }));
      setNotice("Rank recorded.");
      await loadTrend(id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to record rank.");
    }
  }

  async function loadGrid(id: string) {
    setErr(null);
    try {
      const g = await api.get<GridResult | null>(
        `/api/v1/gmb/keywords/${id}/grid-snapshots/latest`,
      );
      setGrids((s) => ({ ...s, [id]: g }));
      if (!g) setNotice("No grid scan yet for this keyword — run one.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load the grid.");
    }
  }

  async function captureGrid(id: string) {
    setErr(null);
    setGridBusy(id);
    try {
      const g = await api.post<GridResult>(
        `/api/v1/gmb/keywords/${id}/grid-snapshots`,
        {},
      );
      setGrids((s) => ({ ...s, [id]: g }));
      setNotice("Grid scan complete.");
      await loadTrend(id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Grid scan failed.");
    } finally {
      setGridBusy(null);
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Ranking tracker</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Find local-SEO keywords, track them, and record rank checks to watch your trend over time.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="mb-4">
        <GmbLocationSwitcher />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">AI keyword finder</h2>
          <form onSubmit={generate} className="mt-3 space-y-3">
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (e.g. Cafe)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (e.g. Pune)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input value={services} onChange={(e) => setServices(e.target.value)} placeholder="Services, comma-separated" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Generate ideas</button>
          </form>
          {ideas.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {ideaSource && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ideaSource === "ai" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                  {ideaSource === "ai" ? "AI-generated" : "Starter ideas"}
                </span>
              )}
              {clusters.map((c) => (
                <span key={c.kind} title={c.topKeywords.join(", ")} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                  {c.kind.replace("_", " ")} × {c.count}
                </span>
              ))}
            </div>
          )}
          {ideas.length > 0 && (
            <ul className="mt-3 space-y-2">
              {ideas.map((idea) => (
                <li key={idea.keyword} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <span><span className="text-slate-800">{idea.keyword}</span> <span className="text-xs text-slate-400">· {idea.kind} · {idea.score}</span></span>
                  <button onClick={() => void track(idea.keyword)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Track</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-slate-950">Tracked keywords</h2>
          {keywords.length > 0 && (() => {
            const checked = keywords.filter((k) => k.bucket != null);
            const tally = { top3: 0, top10: 0, beyond: 0, not_found: 0 } as Record<string, number>;
            for (const k of checked) tally[k.bucket as string] = (tally[k.bucket as string] ?? 0) + 1;
            const visibility = checked.length > 0 ? Math.round(((tally.top3 + tally.top10 * 0.5) / checked.length) * 100) : null;
            const unchecked = keywords.length - checked.length;
            return (
              <div className="mb-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Visibility score</p>
                  <span className={`text-2xl font-bold ${visibility == null ? "text-slate-400" : visibility >= 70 ? "text-emerald-600" : visibility >= 40 ? "text-amber-600" : "text-red-600"}`}>
                    {visibility == null ? "—" : `${visibility}/100`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {tally.top3} in top 3 · {tally.top10} in top 10 · {tally.beyond} beyond · {tally.not_found} not found
                  {unchecked > 0 && ` · ${unchecked} unchecked`}
                </p>
              </div>
            );
          })()}
          <div className="space-y-3">
            {keywords.length === 0 && <p className="text-sm text-slate-500">No keywords tracked yet.</p>}
            {keywords.map((k) => {
              const d = detail[k.id];
              const bucket = d?.trend?.bucket ?? k.bucket;
              const latest = d?.trend ? d.trend.latest : k.latestRank;
              return (
                <div key={k.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">{k.keyword}</span>
                    {bucket != null && (
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${BUCKET_STYLES[bucket]}`}>
                        {latest == null ? "not found" : `#${latest}`}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      placeholder="rank"
                      value={rankInputs[k.id] ?? ""}
                      onChange={(e) => setRankInputs((r) => ({ ...r, [k.id]: e.target.value }))}
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                    <button onClick={() => void recordRank(k.id)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Record</button>
                    <button onClick={() => void loadTrend(k.id)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Trend</button>
                    <button onClick={() => void loadGrid(k.id)} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100">Grid map</button>
                    <button
                      onClick={() => void captureGrid(k.id)}
                      disabled={gridBusy === k.id}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {gridBusy === k.id ? "Scanning…" : "Run grid scan"}
                    </button>
                  </div>
                  {d?.trend && (
                    <p className="mt-2 text-xs text-slate-500">
                      latest {d.trend.latest ?? "—"} · prev {d.trend.previous ?? "—"} · Δ {d.trend.delta ?? "—"} · best {d.trend.best ?? "—"} · avg {d.trend.average ?? "—"} · {d.trend.checks} checks
                    </p>
                  )}
                  {grids[k.id] && (() => {
                    const g = grids[k.id]!;
                    const rivals = g.battleMap?.rivals ?? [];
                    const viewing = battleView[k.id] ?? null;
                    const rival = viewing
                      ? rivals.find((r) => r.name === viewing) ?? null
                      : null;
                    // Battle map: swap the heat-map to the selected rival's
                    // ranks (index-aligned with the same points), or ours.
                    const cellRanks = rival
                      ? g.points.map((_, i) => rival.ranks[i] ?? null)
                      : g.points.map((p) => p.rank);
                    const foundShare = rival
                      ? rival.foundShare
                      : g.stats.foundShare;
                    const avgRank = rival ? rival.avgRank : g.stats.avgRank;
                    const top3Share = rival
                      ? cellRanks.filter((r) => r !== null && r <= 3).length /
                        (cellRanks.length || 1)
                      : g.stats.top3Share;
                    return (
                      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                        {rivals.length > 0 && (
                          <div className="mb-3">
                            <p className="mb-1.5 text-xs font-semibold text-slate-700">
                              Competitor battle map
                              <span className="ml-1.5 font-normal text-slate-400">
                                compare your grid against a rival&apos;s
                              </span>
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setBattleView((v) => ({ ...v, [k.id]: null }))
                                }
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                  !viewing
                                    ? "bg-emerald-600 text-white"
                                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                }`}
                              >
                                You
                              </button>
                              {rivals.map((r) => (
                                <button
                                  key={r.name}
                                  type="button"
                                  onClick={() =>
                                    setBattleView((v) => ({ ...v, [k.id]: r.name }))
                                  }
                                  title={`Seen at ${Math.round(r.foundShare * 100)}% of points · avg rank ${r.avgRank ?? "—"}`}
                                  className={`max-w-[10rem] truncate rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    viewing === r.name
                                      ? "bg-slate-900 text-white"
                                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                  }`}
                                >
                                  {r.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div
                          className="mx-auto grid max-w-xs gap-1.5"
                          style={{ gridTemplateColumns: `repeat(${g.gridSize}, minmax(0, 1fr))` }}
                        >
                          {g.points.map((p, i) => (
                            <div
                              key={i}
                              title={`${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}
                              className={`flex aspect-square items-center justify-center rounded-lg text-sm font-bold ${gridCellClass(cellRanks[i])}`}
                            >
                              {cellRanks[i] ?? "—"}
                            </div>
                          ))}
                        </div>
                        {rival && (
                          <p className="mt-2 text-center text-[11px] font-medium text-slate-500">
                            Showing <span className="font-semibold text-slate-800">{rival.name}</span>
                            {" · seen at "}
                            {Math.round(foundShare * 100)}% of points
                          </p>
                        )}
                        <div className="mt-3 flex items-center justify-center gap-6 text-center">
                          <div>
                            <p className="text-lg font-bold text-emerald-600">{avgRank ?? "—"}</p>
                            <p className="text-[11px] text-slate-500">Avg rank</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-slate-900">{Math.round(top3Share * 100)}%</p>
                            <p className="text-[11px] text-slate-500">Top-3 share</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-slate-900">{g.points.length}</p>
                            <p className="text-[11px] text-slate-500">Grid points</p>
                          </div>
                        </div>
                        <p className="mt-2 text-center text-[11px] text-slate-400">
                          {g.radiusKm} km radius · scanned {new Date(g.capturedAt).toLocaleString()}
                        </p>
                        {(g.leaderboard?.length ?? 0) > 0 && (
                          <div className="mt-4 border-t border-slate-100 pt-3">
                            <p className="text-xs font-semibold text-slate-700">
                              Local leaderboard
                              <span className="ml-1.5 font-normal text-slate-400">
                                at the map centre for this keyword
                              </span>
                            </p>
                            <ol className="mt-2 space-y-1">
                              {g.leaderboard!.map((entry) => (
                                <li
                                  key={entry.rank}
                                  className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
                                    entry.isYou
                                      ? "bg-emerald-50 font-semibold text-emerald-700"
                                      : "text-slate-600"
                                  }`}
                                >
                                  <span
                                    className={`grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-bold ${
                                      entry.isYou
                                        ? "bg-emerald-600 text-white"
                                        : "bg-slate-100 text-slate-500"
                                    }`}
                                  >
                                    {entry.rank}
                                  </span>
                                  <span className="truncate">{entry.name}</span>
                                  {entry.isYou && (
                                    <span className="ml-auto flex-none rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                                      You
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Rank-drop alert rules (Adgrowly GMB Panel — "Create alert rule"). */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Rank alert rules</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Get notified when a tracked keyword drops out of your target range. Alerts fire once
              per drop and re-arm after the rank recovers.
            </p>
          </div>
        </div>

        <form onSubmit={createAlertRule} className="mt-4 grid gap-3 sm:grid-cols-[1fr,150px,1fr,auto]">
          <select
            value={alertKeywordId}
            onChange={(e) => setAlertKeywordId(e.target.value)}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Choose a tracked keyword…</option>
            {keywords.map((k) => (
              <option key={k.id} value={k.id}>
                {k.keyword}
              </option>
            ))}
          </select>
          <select
            value={alertThreshold}
            onChange={(e) => setAlertThreshold(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            title="Alert when the rank falls below this"
          >
            <option value="3">Out of top 3</option>
            <option value="10">Out of top 10</option>
            <option value="20">Out of top 20</option>
          </select>
          <input
            type="email"
            value={alertEmail}
            onChange={(e) => setAlertEmail(e.target.value)}
            placeholder="Email (optional — in-app only if empty)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={alertBusy || !alertKeywordId}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {alertBusy ? "Creating…" : "Create alert rule"}
          </button>
        </form>

        {alertRules.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            No alert rules yet. Create one to watch a keyword.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {alertRules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-medium text-slate-900">{r.keyword.keyword}</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  alert past top {r.thresholdRank}
                </span>
                {r.notifyEmail && (
                  <span className="text-xs text-slate-500">→ {r.notifyEmail}</span>
                )}
                <span className="ml-auto text-xs text-slate-400">
                  {r.lastTriggeredAt
                    ? `Last sent ${new Date(r.lastTriggeredAt).toLocaleString()} (${
                        r.lastTriggeredRank === null ? "not found" : `#${r.lastTriggeredRank}`
                      })`
                    : "Never triggered"}
                </span>
                <button
                  type="button"
                  onClick={() => void toggleAlertRule(r)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    r.isActive
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {r.isActive ? "Active" : "Paused"}
                </button>
                <button
                  type="button"
                  onClick={() => void removeAlertRule(r.id)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardShell>
  );
}
