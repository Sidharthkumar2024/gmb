"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Citations — name/address/phone consistency across directories.
//
// The whole point is that Google cross-checks your details elsewhere, so this
// screen shows exactly WHICH field disagrees rather than a bare "inconsistent".
// A per-field diff is the difference between a fixable task and a shrug.

type CitationStatus = "LIVE" | "PENDING" | "MISSING";

interface Nap {
  name: string | null;
  address: string | null;
  phone: string | null;
}

interface Citation {
  id: string;
  locationId: string;
  directory: string;
  listingUrl: string | null;
  nap: Nap;
  status: CitationStatus;
  consistency: {
    score: number;
    consistent: boolean;
    fields: { name: string; address: string; phone: string };
  } | null;
  lastCheckedAt: string | null;
}

interface LocationLite {
  id: string;
  name: string;
}

const STATUS_TONE: Record<CitationStatus, "ok" | "warn" | "danger"> = {
  LIVE: "ok",
  PENDING: "warn",
  MISSING: "danger",
};

const FIELD_TONE: Record<string, string> = {
  match: "text-gmb-ok",
  mismatch: "text-gmb-danger",
  missing: "text-gmb-ink-subtle",
};

export default function GmbCitationsPage() {
  const [locations, setLocations] = useState<LocationLite[]>([]);
  const [locationId, setLocationId] = useState("");
  const [items, setItems] = useState<Citation[] | null>(null);
  const [summary, setSummary] = useState<{ total: number; consistent: number; consistencyScore: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Directories the scan says you are NOT on yet. This is the most actionable
  // thing the scan returns for a new profile, so it gets its own panel rather
  // than being dropped on the floor.
  const [missing, setMissing] = useState<string[]>([]);

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
    setError(null);
    try {
      const [list, sum] = await Promise.all([
        api.get<Citation[]>(`/api/v1/gmb/citations?locationId=${locationId}`),
        api
          .get<{ total: number; consistent: number; consistencyScore: number }>(
            `/api/v1/gmb/citations/summary?locationId=${locationId}`,
          )
          .catch(() => null),
      ]);
      setItems(list ?? []);
      setSummary(sum);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load citations.");
      setItems([]);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function scan() {
    setBusy("scan");
    setError(null);
    try {
      const result = await api.post<{ missingRecommended: string[] }>(
        "/api/v1/gmb/citations/scan",
        { locationId },
      );
      setMissing(result?.missingRecommended ?? []);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not run the scan.");
    } finally {
      setBusy(null);
    }
  }

  /** Record a listing on a directory the scan flagged as missing. */
  async function addDirectory(directory: string) {
    setBusy(directory);
    setError(null);
    try {
      await api.post("/api/v1/gmb/citations", {
        locationId,
        directory,
        // PENDING, not LIVE: we have not verified the listing exists — the
        // owner marks it live once they've actually created it.
        status: "PENDING",
      });
      setMissing((m) => m.filter((d) => d !== directory));
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not add the listing.");
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(c: Citation, status: CitationStatus) {
    setBusy(c.id);
    try {
      await api.patch(`/api/v1/gmb/citations/${c.id}`, { status });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update the listing.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(c: Citation) {
    setBusy(c.id);
    try {
      await api.delete(`/api/v1/gmb/citations/${c.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not remove the listing.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <GmbShell title="Citations">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-3.5 grid grid-cols-4 gap-3.5">
        <Card>
          <SectionLabel>Listings tracked</SectionLabel>
          <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
            {summary?.total ?? items?.length ?? "—"}
          </div>
        </Card>
        <Card>
          <SectionLabel>Consistent</SectionLabel>
          <div
            className={`mt-1.5 text-[28px] font-bold tracking-[-0.02em] ${
              summary && summary.consistent === summary.total && summary.total > 0
                ? "text-gmb-ok"
                : "text-gmb-warn"
            }`}
          >
            {summary?.consistent ?? "—"}
          </div>
          <div className="mt-1 text-xs2 text-gmb-ink-muted">
            {summary ? `of ${summary.total}` : " "}
          </div>
        </Card>
        <Card>
          <SectionLabel>Consistency score</SectionLabel>
          <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
            {summary ? `${summary.consistencyScore}%` : "—"}
          </div>
        </Card>
        <Card>
          <SectionLabel>Scan directories</SectionLabel>
          <div className="mt-1 text-xs2 text-gmb-ink-muted">
            Checks the directories that matter for your category.
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button variant="dark" disabled={busy === "scan" || !locationId} onClick={() => void scan()}>
              {busy === "scan" ? "Scanning…" : "Run scan"}
            </Button>
            {locations.length > 1 && (
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="rounded-control border border-gmb-line bg-gmb-surface px-2.5 py-2 text-sm2 outline-none"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </Card>
      </div>

      {/* Directories the scan says you're absent from — the actionable gap. */}
      {missing.length > 0 && (
        <Card className="mb-3.5 border-gmb-warn/30 bg-gmb-warn-bg">
          <div className="flex items-center gap-2">
            <SectionLabel>Not listed yet</SectionLabel>
            <Pill tone="warn">{missing.length}</Pill>
          </div>
          <div className="mt-1 text-sm2 text-gmb-ink-muted">
            Google cross-references these. Create the listing on each site, then track it here so
            we can watch for detail drift.
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {missing.map((d) => (
              <button
                key={d}
                type="button"
                disabled={busy === d}
                onClick={() => void addDirectory(d)}
                className="rounded-full border border-gmb-warn/40 bg-gmb-surface px-3 py-1.5 text-xs2 font-semibold text-gmb-ink hover:border-gmb-brand-border disabled:opacity-50"
              >
                {busy === d ? "Adding…" : `+ ${d}`}
              </button>
            ))}
          </div>
        </Card>
      )}

      {items === null ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No listings tracked yet"
          body="Run a scan to check the directories Google cross-references for your category — mismatched name, address or phone details quietly cost you rankings."
          action={
            <Button variant="dark" disabled={!locationId} onClick={() => void scan()}>
              Run first scan
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((c) => {
            const working = busy === c.id;
            const f = c.consistency?.fields;
            return (
              <Card key={c.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold">{c.directory}</span>
                      <Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill>
                      {c.consistency &&
                        (c.consistency.consistent ? (
                          <Pill tone="ok">Matches your profile</Pill>
                        ) : (
                          <Pill tone="danger">
                            {Math.round(c.consistency.score * 100)}% match
                          </Pill>
                        ))}
                      {c.listingUrl && (
                        <a
                          href={c.listingUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="font-geist-mono text-micro text-gmb-brand"
                        >
                          view listing ↗
                        </a>
                      )}
                    </div>

                    {/* Per-field diff — the actionable part. */}
                    {f && (
                      <div className="mt-2.5 grid gap-1.5 sm:grid-cols-3">
                        {(
                          [
                            ["Name", f.name, c.nap.name],
                            ["Address", f.address, c.nap.address],
                            ["Phone", f.phone, c.nap.phone],
                          ] as const
                        ).map(([label, state, value]) => (
                          <div
                            key={label}
                            className="rounded-control border border-gmb-line bg-gmb-subtle px-2.5 py-1.5"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle">
                                {label}
                              </span>
                              <span
                                className={`font-geist-mono text-micro font-semibold ${FIELD_TONE[state] ?? ""}`}
                              >
                                {state}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate text-xs2 text-gmb-ink-muted" title={value ?? ""}>
                              {value || "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 font-geist-mono text-micro text-gmb-ink-subtle">
                      {c.lastCheckedAt
                        ? `checked ${new Date(c.lastCheckedAt).toLocaleDateString()}`
                        : "never checked"}
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 gap-1.5">
                    {c.status !== "LIVE" && (
                      <Button variant="ghost" disabled={working} onClick={() => void setStatus(c, "LIVE")}>
                        Mark live
                      </Button>
                    )}
                    <Button variant="ghost" disabled={working} onClick={() => void remove(c)}>
                      Remove
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </GmbShell>
  );
}
