"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { rankColor } from "../../src/components/gmb/RankGrid";
import { api, ApiClientError } from "../../src/lib/api";

// Rank tracker — grid heat-map, local leaderboard and competitor battle map.
//
// The grid is the product's core claim: Google ranks you differently one block
// over, so a single "your rank is #4" is a fiction. Everything here is drawn
// from one captured snapshot, so the map, the leaderboard and the battle map
// can never disagree with each other.
//
// A capture costs real Places API calls, so the button says so and is never
// fired automatically.

interface Keyword {
  id: string;
  locationId: string;
  keyword: string;
  isActive: boolean;
  latestRank?: number | null;
  lastCheckedAt?: string | null;
}

interface GridPoint {
  lat: number;
  lng: number;
  rank: number | null;
}

interface Rival {
  name: string;
  ranks: Array<number | null>;
  avgRank: number | null;
  foundShare: number;
}

interface Snapshot {
  snapshotId: string;
  gridSize: number;
  radiusKm: number;
  points: GridPoint[];
  stats: { avgRank: number | null; top3Share: number; foundShare: number };
  leaderboard: Array<{ rank: number; name: string; isYou: boolean }>;
  battleMap: { rivals: Rival[] };
  capturedAt: string;
}

interface LocationLite {
  id: string;
  name: string;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default function GmbRankingPage() {
  const [locations, setLocations] = useState<LocationLite[]>([]);
  const [locationId, setLocationId] = useState("");
  const [keywords, setKeywords] = useState<Keyword[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = show our own ranks; otherwise the rival being overlaid.
  const [rivalIdx, setRivalIdx] = useState<number | null>(null);

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

  const loadKeywords = useCallback(async () => {
    if (!locationId) return;
    setError(null);
    try {
      const rows = await api.get<Keyword[]>(`/api/v1/gmb/keywords?locationId=${locationId}`);
      setKeywords(rows ?? []);
      setSelectedId((cur) => (rows?.some((r) => r.id === cur) ? cur : (rows?.[0]?.id ?? "")));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load keywords.");
      setKeywords([]);
    }
  }, [locationId]);

  useEffect(() => {
    void loadKeywords();
  }, [loadKeywords]);

  const loadSnapshot = useCallback(async () => {
    if (!selectedId) {
      setSnapshot(null);
      return;
    }
    setLoadingSnap(true);
    setRivalIdx(null);
    try {
      setSnapshot(
        await api.get<Snapshot | null>(`/api/v1/gmb/keywords/${selectedId}/grid-snapshots/latest`),
      );
    } catch {
      setSnapshot(null);
    } finally {
      setLoadingSnap(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  async function addKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyword.trim() || !locationId) return;
    setBusy("add");
    setError(null);
    try {
      await api.post("/api/v1/gmb/keywords", { locationId, keyword: newKeyword.trim() });
      setNewKeyword("");
      await loadKeywords();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add the keyword.");
    } finally {
      setBusy(null);
    }
  }

  async function removeKeyword(id: string, word: string) {
    if (!window.confirm(`Stop tracking "${word}"? Its scan history goes with it.`)) return;
    setBusy(id);
    try {
      await api.delete(`/api/v1/gmb/keywords/${id}`);
      await loadKeywords();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not remove the keyword.");
    } finally {
      setBusy(null);
    }
  }

  async function capture() {
    if (!selectedId) return;
    setBusy("capture");
    setError(null);
    try {
      await api.post(`/api/v1/gmb/keywords/${selectedId}/grid-snapshots`, { gridSize: 7 });
      await loadSnapshot();
      await loadKeywords();
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : "Could not run the scan. A Google Places API key is required.",
      );
    } finally {
      setBusy(null);
    }
  }

  const selected = useMemo(
    () => (keywords ?? []).find((k) => k.id === selectedId) ?? null,
    [keywords, selectedId],
  );

  // Which ranks the heat-map paints: ours, or the selected rival's — the two
  // are index-aligned to the same points array, so the map stays comparable.
  const shownRanks: Array<number | null> = useMemo(() => {
    if (!snapshot) return [];
    if (rivalIdx === null) return snapshot.points.map((p) => p.rank);
    return snapshot.battleMap.rivals[rivalIdx]?.ranks ?? [];
  }, [snapshot, rivalIdx]);

  const shownStats = useMemo(() => {
    if (!snapshot) return null;
    if (rivalIdx === null) return snapshot.stats;
    const r = snapshot.battleMap.rivals[rivalIdx];
    if (!r) return snapshot.stats;
    const top3 = r.ranks.filter((x) => x !== null && x <= 3).length;
    return {
      avgRank: r.avgRank,
      top3Share: r.ranks.length ? top3 / r.ranks.length : 0,
      foundShare: r.foundShare,
    };
  }, [snapshot, rivalIdx]);

  return (
    <GmbShell title="Rank tracker">
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Keyword bar */}
      <Card className="mb-3.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <SectionLabel>Tracked keywords</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {keywords === null ? (
                <Skeleton className="h-8 w-64" />
              ) : keywords.length === 0 ? (
                <span className="text-sm2 text-gmb-ink-muted">None yet — add one to begin.</span>
              ) : (
                keywords.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setSelectedId(k.id)}
                    className={`group flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs2 font-semibold transition ${
                      selectedId === k.id
                        ? "bg-gmb-brand text-white"
                        : "border border-gmb-line bg-gmb-surface text-gmb-ink-muted hover:border-gmb-brand-border"
                    }`}
                  >
                    {k.keyword}
                    {typeof k.latestRank === "number" && (
                      <span className="font-geist-mono opacity-70">#{k.latestRank}</span>
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${k.keyword}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeKeyword(k.id, k.keyword);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          void removeKeyword(k.id, k.keyword);
                        }
                      }}
                      className="opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                    >
                      ×
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {locations.length > 1 && (
            <label className="font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle">
              Location
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="mt-1 block rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <form onSubmit={addKeyword} className="mt-3 flex gap-2 border-t border-gmb-line-soft pt-3">
          <input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="Add a keyword, e.g. dentist near me"
            className="flex-1 rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 outline-none focus:border-gmb-brand-border"
          />
          <Button type="submit" disabled={!newKeyword.trim() || !locationId || busy === "add"}>
            {busy === "add" ? "Adding…" : "Track keyword"}
          </Button>
        </form>
      </Card>

      {!selected ? (
        <EmptyState
          title="No keyword selected"
          body="Track a keyword above, then run a scan to see where you rank across your service area."
        />
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          {/* Heat-map */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <SectionLabel>Grid heat-map</SectionLabel>
                <div className="mt-0.5 text-[15px] font-semibold">{selected.keyword}</div>
              </div>
              <Button
                variant="dark"
                disabled={busy === "capture"}
                onClick={() => void capture()}
              >
                {busy === "capture" ? "Scanning…" : snapshot ? "Re-scan" : "Run scan"}
              </Button>
            </div>

            {loadingSnap ? (
              <Skeleton className="mt-4 h-[300px]" />
            ) : !snapshot ? (
              <div className="mt-4 rounded-control border border-dashed border-gmb-line bg-gmb-subtle p-6 text-center">
                <div className="text-[13px] font-semibold">No scan yet</div>
                <div className="mx-auto mt-1 max-w-sm text-sm2 text-gmb-ink-muted">
                  A scan runs a Google search from a grid of points around your location. It uses
                  Places API credits, so it only runs when you ask.
                </div>
              </div>
            ) : (
              <>
                {/* Rival toggle */}
                {snapshot.battleMap.rivals.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRivalIdx(null)}
                      className={`rounded-full px-3 py-1 text-micro font-semibold ${
                        rivalIdx === null
                          ? "bg-gmb-brand text-white"
                          : "border border-gmb-line text-gmb-ink-muted"
                      }`}
                    >
                      You
                    </button>
                    {snapshot.battleMap.rivals.map((r, i) => (
                      <button
                        key={r.name}
                        type="button"
                        onClick={() => setRivalIdx(i)}
                        className={`rounded-full px-3 py-1 text-micro font-semibold ${
                          rivalIdx === i
                            ? "bg-gmb-night text-white"
                            : "border border-gmb-line text-gmb-ink-muted"
                        }`}
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}

                <div
                  className="mx-auto mt-4 grid max-w-[340px] gap-[5px]"
                  style={{ gridTemplateColumns: `repeat(${snapshot.gridSize}, minmax(0,1fr))` }}
                >
                  {shownRanks.map((r, i) => (
                    <div
                      key={i}
                      title={r === null ? "Not in results here" : `Rank ${r}`}
                      className="flex aspect-square items-center justify-center rounded-full font-geist-mono text-[10px] font-medium text-white"
                      style={{ background: rankColor(r ?? 0) }}
                    >
                      {r === null ? "–" : r}
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-gmb-line-soft pt-3 text-center">
                  <div>
                    <div className="text-lg font-bold">
                      {shownStats?.avgRank !== null && shownStats?.avgRank !== undefined
                        ? shownStats.avgRank.toFixed(1)
                        : "—"}
                    </div>
                    <div className="text-micro uppercase tracking-wide text-gmb-ink-subtle">
                      avg rank
                    </div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-gmb-ok">
                      {shownStats ? pct(shownStats.top3Share) : "—"}
                    </div>
                    <div className="text-micro uppercase tracking-wide text-gmb-ink-subtle">
                      in top 3
                    </div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">
                      {shownStats ? pct(shownStats.foundShare) : "—"}
                    </div>
                    <div className="text-micro uppercase tracking-wide text-gmb-ink-subtle">
                      coverage
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between font-geist-mono text-micro text-gmb-ink-subtle">
                  <span>
                    {snapshot.gridSize}×{snapshot.gridSize} · {snapshot.radiusKm}km radius
                  </span>
                  <span>scanned {new Date(snapshot.capturedAt).toLocaleString()}</span>
                </div>
              </>
            )}
          </Card>

          {/* Leaderboard + rivals */}
          <div className="flex flex-col gap-3.5">
            <Card>
              <SectionLabel>Local leaderboard</SectionLabel>
              {!snapshot || snapshot.leaderboard.length === 0 ? (
                <div className="mt-3 text-sm2 text-gmb-ink-muted">
                  {snapshot
                    ? "No competitor list in this scan."
                    : "Run a scan to see who ranks around you."}
                </div>
              ) : (
                <ol className="mt-3 flex list-none flex-col gap-1.5 p-0">
                  {snapshot.leaderboard.map((c) => (
                    <li
                      key={`${c.rank}-${c.name}`}
                      className={`flex items-center gap-3 rounded-control px-2.5 py-1.5 ${
                        c.isYou ? "bg-gmb-brand-wash" : ""
                      }`}
                    >
                      <span className="w-5 font-geist-mono text-micro text-gmb-ink-subtle">
                        {c.rank}
                      </span>
                      <span
                        className={`flex-1 truncate text-sm2 ${
                          c.isYou ? "font-semibold text-gmb-brand" : "text-gmb-ink"
                        }`}
                      >
                        {c.name}
                      </span>
                      {c.isYou && <Pill tone="brand">You</Pill>}
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card>
              <SectionLabel>Who&rsquo;s beating you where</SectionLabel>
              {!snapshot || snapshot.battleMap.rivals.length === 0 ? (
                <div className="mt-3 text-sm2 text-gmb-ink-muted">
                  {snapshot
                    ? "No rivals appeared often enough to compare."
                    : "Run a scan to compare against rivals."}
                </div>
              ) : (
                <>
                  <div className="mt-1 text-xs2 text-gmb-ink-muted">
                    Select a rival to repaint the map with their ranks.
                  </div>
                  <div className="mt-3 flex flex-col gap-1.5">
                    {snapshot.battleMap.rivals.map((r, i) => (
                      <button
                        key={r.name}
                        type="button"
                        onClick={() => setRivalIdx(rivalIdx === i ? null : i)}
                        className={`flex items-center gap-3 rounded-control border px-3 py-2 text-left transition ${
                          rivalIdx === i
                            ? "border-gmb-brand bg-gmb-brand-wash"
                            : "border-gmb-line hover:border-gmb-brand-border"
                        }`}
                      >
                        <span className="flex-1 truncate text-sm2 font-medium">{r.name}</span>
                        <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                          avg {r.avgRank !== null ? r.avgRank.toFixed(1) : "—"}
                        </span>
                        <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                          {pct(r.foundShare)} coverage
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </Card>

            <Card>
              <SectionLabel>Reading the map</SectionLabel>
              <div className="mt-2.5 flex flex-col gap-1.5 text-xs2 text-gmb-ink-muted">
                {[
                  ["#22c55e", "Top 3 — you show in the map pack here"],
                  ["#f59e0b", "4–7 — visible, but below the fold"],
                  ["#f04438", "8+ — effectively invisible"],
                  ["#c9c7d4", "Not in results at this point"],
                ].map(([color, label]) => (
                  <span key={label} className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ background: color }}
                    />
                    {label}
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </GmbShell>
  );
}
