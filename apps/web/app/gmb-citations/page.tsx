"use client";

// AdGrowly — Citations (planning PDF §2/§3). Track NAP listings across
// directories and see consistency vs the location's canonical profile.
// Backed by module 5: /api/v1/gmb/citations (+ /summary).

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { GmbLocationSwitcher } from "../../src/components/GmbLocationSwitcher";
import { useAuth } from "../../src/hooks/useAuth";
import { useGmbLocation } from "../../src/hooks/useGmbLocation";
import { api, ApiClientError } from "../../src/lib/api";

type NapField = "match" | "mismatch" | "na";

interface Citation {
  id: string;
  directory: string;
  listingUrl: string | null;
  nap: { name: string | null; address: string | null; phone: string | null };
  status: "LIVE" | "PENDING" | "MISSING";
  consistency: { name: NapField; address: NapField; phone: NapField; score: number; consistent: boolean } | null;
}

interface Summary {
  total: number;
  live: number;
  pending: number;
  missing: number;
  consistent: number;
  inconsistent: number;
  consistencyScore: number;
}

const STATUS_STYLES: Record<string, string> = {
  LIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  MISSING: "bg-red-50 text-red-700 border-red-200",
};

const FIELD_STYLES: Record<NapField, string> = {
  match: "bg-emerald-50 text-emerald-700",
  mismatch: "bg-red-50 text-red-700",
  na: "bg-slate-100 text-slate-500",
};

function FieldBadge({ label, state }: { label: string; state: NapField }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${FIELD_STYLES[state]}`}>{label}: {state}</span>;
}

export default function GmbCitationsPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [locationId] = useGmbLocation();
  const [items, setItems] = useState<Citation[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [directory, setDirectory] = useState("");
  const [listingUrl, setListingUrl] = useState("");
  const [napName, setNapName] = useState("");
  const [napAddress, setNapAddress] = useState("");
  const [napPhone, setNapPhone] = useState("");
  const [scan, setScan] = useState<{ mismatches: { directory: string }[]; missingRecommended: string[]; consistencyScore: number } | null>(null);
  const [scanning, setScanning] = useState(false);

  async function runScan() {
    if (!locationId) {
      setErr("Select a location to scan.");
      return;
    }
    setScanning(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await api.post<{ mismatches: { directory: string }[]; missingRecommended: string[]; consistencyScore: number }>(
        "/api/v1/gmb/citations/scan",
        { locationId },
      );
      setScan(res);
      setNotice(`Scan complete — ${Math.round(res.consistencyScore * 100)}% consistent.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to scan citations.");
    } finally {
      setScanning(false);
    }
  }

  async function refresh() {
    try {
      setErr(null);
      const q = locationId.trim() ? `?locationId=${encodeURIComponent(locationId.trim())}` : "";
      const [list, sum] = await Promise.all([
        api.get<Citation[]>(`/api/v1/gmb/citations${q}`),
        api.get<Summary>(`/api/v1/gmb/citations/summary${q}`),
      ]);
      setItems(list);
      setSummary(sum);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load citations.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
    // Reload when the shared location selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, locationId]);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!locationId.trim()) {
      setErr("Enter a Location ID to add a citation.");
      return;
    }
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/citations", {
        locationId: locationId.trim(),
        directory: directory.trim(),
        listingUrl: listingUrl.trim() || undefined,
        napName: napName.trim() || undefined,
        napAddress: napAddress.trim() || undefined,
        napPhone: napPhone.trim() || undefined,
      });
      setDirectory("");
      setListingUrl("");
      setNapName("");
      setNapAddress("");
      setNapPhone("");
      setNotice("Citation added.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to add citation.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this citation?")) return;
    try {
      await api.delete(`/api/v1/gmb/citations/${id}`);
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
        <h1 className="text-2xl font-semibold text-slate-950">Citations</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Track your business listings across directories and keep your Name / Address / Phone consistent.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <GmbLocationSwitcher />
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={scanning}
          title="Recompute NAP consistency and list directories you're missing"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "✨ Scan citations"}
        </button>
      </div>

      {scan && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">NAP mismatches ({scan.mismatches.length})</p>
            {scan.mismatches.length === 0 ? (
              <p className="mt-1 text-sm text-emerald-600">All tracked listings are consistent. ✓</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {scan.mismatches.map((m) => (
                  <li key={m.directory} className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                    {m.directory}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Get listed on ({scan.missingRecommended.length})</p>
            {scan.missingRecommended.length === 0 ? (
              <p className="mt-1 text-sm text-emerald-600">You're on every recommended directory. ✓</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {scan.missingRecommended.map((d) => (
                  <span key={d} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{d}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{summary.total}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Live</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{summary.live}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Missing</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{summary.missing}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">NAP consistency</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{Math.round(summary.consistencyScore * 100)}%</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <form onSubmit={add} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Add citation</h2>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Directory
            <input value={directory} onChange={(e) => setDirectory(e.target.value)} required placeholder="Yelp, Bing, Apple Maps…" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Listing URL
            <input value={listingUrl} onChange={(e) => setListingUrl(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            NAP — name
            <input value={napName} onChange={(e) => setNapName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            NAP — address
            <input value={napAddress} onChange={(e) => setNapAddress(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            NAP — phone
            <input value={napPhone} onChange={(e) => setNapPhone(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Add citation</button>
        </form>

        <div className="space-y-3">
          {items.length === 0 && <p className="text-sm text-slate-500">No citations yet.</p>}
          {items.map((c) => (
            <div key={c.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-800">{c.directory}</div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status]}`}>{c.status}</span>
                  <button onClick={() => void remove(c.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {c.nap.name ?? "—"} · {c.nap.address ?? "—"} · {c.nap.phone ?? "—"}
              </p>
              {c.consistency && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <FieldBadge label="name" state={c.consistency.name} />
                  <FieldBadge label="addr" state={c.consistency.address} />
                  <FieldBadge label="phone" state={c.consistency.phone} />
                  <span className={`text-xs font-medium ${c.consistency.consistent ? "text-emerald-600" : "text-red-600"}`}>
                    {c.consistency.consistent ? "consistent" : `${Math.round(c.consistency.score * 100)}%`}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
