"use client";

// AdGrowly — Reputation (planning PDF §2/§3). View Google reviews, generate an
// AI reply draft (generate-then-approve) and send it. Backed by module 2:
// /api/v1/gmb/reviews (+ /summary, /:id/draft-reply, /:id/reply).

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { GmbQaPanel } from "../../src/components/GmbQaPanel";
import { useAuth } from "../../src/hooks/useAuth";
import { useGmbLocation } from "../../src/hooks/useGmbLocation";
import { api, ApiClientError } from "../../src/lib/api";

interface Review {
  id: string;
  locationId: string;
  authorName: string | null;
  rating: number;
  comment: string | null;
  status: "NEW" | "REPLIED" | "FLAGGED";
  replyText: string | null;
  repliedAt?: string | null;
  isGoogleSynced: boolean;
}

interface Location {
  id: string;
  name: string;
  placeId: string | null;
  status: "DRAFT" | "CONNECTED" | "SUSPENDED";
  rating: number | null;
  reviewCount: number;
  hasCredential: boolean;
  lastSyncedAt: string | null;
}

interface Summary {
  count: number;
  average: number;
  unanswered: number;
  distribution: Record<string, number>;
}

type ReviewStatusFilter = "" | Review["status"];

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-amber-50 text-amber-700 border-amber-200",
  REPLIED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FLAGGED: "bg-slate-100 text-slate-600 border-slate-200",
};

function Stars({ n }: { n: number }) {
  return <span className="text-amber-500">{"★".repeat(n)}{"☆".repeat(Math.max(0, 5 - n))}</span>;
}

export default function GmbReputationPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useGmbLocation();
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>("");

  const [manualLocationId, setManualLocationId] = useState("");
  const [rating, setRating] = useState(5);
  const [author, setAuthor] = useState("");
  const [comment, setComment] = useState("");

  async function askForReview() {
    const to = window.prompt("Send a review request to which WhatsApp number? (E.164, e.g. +9198…)");
    if (!to?.trim()) return;
    const customerName = window.prompt("Customer name (optional):") ?? "";
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/review-request", {
        to: to.trim(),
        locationId: selectedLocationId || locations[0]?.id || undefined,
        customerName: customerName.trim() || undefined,
      });
      setNotice(`Review request sent to ${to.trim()} on WhatsApp.`);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to send the review request.");
    }
  }

  async function refresh() {
    try {
      setErr(null);
      const reviewParams = new URLSearchParams();
      if (selectedLocationId) reviewParams.set("locationId", selectedLocationId);
      if (statusFilter) reviewParams.set("status", statusFilter);
      const summaryParams = new URLSearchParams();
      if (selectedLocationId) summaryParams.set("locationId", selectedLocationId);
      const [nextLocations, nextReviews, nextSummary] = await Promise.all([
        api.get<Location[]>("/api/v1/gmb/locations"),
        api.get<Review[]>(`/api/v1/gmb/reviews${reviewParams.size ? `?${reviewParams}` : ""}`),
        api.get<Summary>(`/api/v1/gmb/reviews/summary${summaryParams.size ? `?${summaryParams}` : ""}`),
      ]);
      setLocations(nextLocations);
      setReviews(nextReviews);
      setSummary(nextSummary);
      if (!manualLocationId && nextLocations.length > 0) {
        setManualLocationId(nextLocations[0].id);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load reviews.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user, selectedLocationId, statusFilter]);

  async function addReview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/reviews", {
        locationId: manualLocationId.trim(),
        rating,
        authorName: author.trim() || undefined,
        comment: comment.trim() || undefined,
      });
      setAuthor("");
      setComment("");
      setNotice("Review logged.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to log review.");
    }
  }

  async function autoDraftReplies() {
    setBusy("auto-draft");
    setErr(null);
    setNotice(null);
    try {
      const res = await api.post<{ drafted: number; scanned: number }>("/api/v1/gmb/reviews/auto-draft", {
        ...(selectedLocationId ? { locationId: selectedLocationId } : {}),
      });
      setNotice(
        res.drafted > 0
          ? `Drafted ${res.drafted} replies — review and send each below.`
          : "No un-answered reviews to draft.",
      );
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to auto-draft replies.");
    } finally {
      setBusy(null);
    }
  }

  async function syncSelectedLocation() {
    if (!selectedLocationId) {
      setErr("Choose one location before syncing reviews.");
      return;
    }
    const location = locations.find((item) => item.id === selectedLocationId);
    if (!location) {
      setErr("Selected location was not found.");
      return;
    }
    setBusy("sync");
    setErr(null);
    setNotice(null);
    try {
      const source = location.hasCredential && location.placeId ? "GOOGLE" : "MANUAL";
      const res = await api.post<Location & { importedReviews?: number; updatedReviews?: number; syncSource?: string }>(
        `/api/v1/gmb/locations/${location.id}/sync`,
        { source },
      );
      const detail =
        res.syncSource === "GOOGLE"
          ? ` Imported ${res.importedReviews ?? 0}, updated ${res.updatedReviews ?? 0} reviews.`
          : " Refreshed local stats.";
      setNotice(`${location.name} synced.${detail}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to sync reviews.");
    } finally {
      setBusy(null);
    }
  }

  async function draft(id: string) {
    setErr(null);
    try {
      const res = await api.post<{ reply: string }>(`/api/v1/gmb/reviews/${id}/draft-reply`, {});
      setDrafts((d) => ({ ...d, [id]: res.reply }));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to draft a reply.");
    }
  }

  async function send(id: string) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setErr(null);
    try {
      const res = await api.post<Review & { publishedToGoogle?: boolean }>(
        `/api/v1/gmb/reviews/${id}/reply`,
        { text },
      );
      setDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      setNotice(res.publishedToGoogle ? "Reply published to Google." : "Reply saved locally.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to send reply.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  const selectedLocation = locations.find((item) => item.id === selectedLocationId) ?? null;
  const manualLocation = locations.find((item) => item.id === manualLocationId) ?? null;
  const locationNameById = new Map(locations.map((item) => [item.id, item.name]));
  const selectedCanSyncFromGoogle = Boolean(selectedLocation?.hasCredential && selectedLocation.placeId);

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-emerald-700">Google Business</p>
          <h1 className="text-2xl font-semibold text-slate-950">Reputation</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Read Google-synced and manually logged reviews, generate a reply draft, edit it and publish after review.
          </p>
        </div>
        <button
          onClick={() => void askForReview()}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Ask for a review (WhatsApp)
        </button>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <section className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto] lg:items-end">
          <label className="block text-sm font-medium text-slate-700">
            Location
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All locations</option>
              {locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{item.rating != null ? ` · ${item.rating}★` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ReviewStatusFilter)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              <option value="NEW">Awaiting reply</option>
              <option value="REPLIED">Replied</option>
              <option value="FLAGGED">Flagged</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void syncSelectedLocation()}
            disabled={!selectedLocationId || busy === "sync"}
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "sync" ? "Syncing..." : selectedCanSyncFromGoogle ? "Sync Google reviews" : "Refresh stats"}
          </button>
          <button
            type="button"
            onClick={() => void autoDraftReplies()}
            disabled={busy === "auto-draft"}
            title="AI-draft a reply for every un-answered review; you approve + send each"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "auto-draft" ? "Drafting…" : "✨ Auto-draft replies"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
          {selectedLocation ? (
            <>
              <span className="rounded-full bg-slate-100 px-2 py-1">{selectedLocation.status}</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">
                {selectedCanSyncFromGoogle ? "Google-connected" : "Manual stats"}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-1">
                {selectedLocation.reviewCount} reviews{selectedLocation.rating != null ? ` · ${selectedLocation.rating}★` : ""}
              </span>
              {selectedLocation.lastSyncedAt && (
                <span className="rounded-full bg-slate-100 px-2 py-1">
                  Last sync {new Date(selectedLocation.lastSyncedAt).toLocaleString()}
                </span>
              )}
            </>
          ) : (
            <span>Choose a location to sync Google reviews directly from this page.</span>
          )}
        </div>
      </section>

      {summary && (
        <div className="mb-6 grid gap-4 lg:grid-cols-[1fr,220px,220px]">
          {/* Rating summary with star-distribution bars (Adgrowly GMB
              Panel design). */}
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-6">
              <div>
                <p className="text-4xl font-bold text-slate-950">{summary.average || "—"}</p>
                <Stars n={Math.round(summary.average)} />
                <p className="mt-1 text-xs text-slate-500">{summary.count} reviews</p>
              </div>
              <div className="flex-1 space-y-1.5">
                {[5, 4, 3, 2, 1].map((star) => {
                  const n = summary.distribution?.[String(star)] ?? 0;
                  const pct = summary.count > 0 ? Math.round((n / summary.count) * 100) : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="w-6">{star} ★</span>
                      <div className="h-2 flex-1 rounded-full bg-slate-100">
                        <div
                          className={`h-2 rounded-full ${star >= 4 ? "bg-emerald-500" : star === 3 ? "bg-amber-500" : "bg-red-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right">{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Response rate</p>
            <p className="mt-1 text-3xl font-bold text-slate-950">
              {summary.count > 0
                ? `${Math.round(((summary.count - summary.unanswered) / summary.count) * 100)}%`
                : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">of reviews replied to</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Awaiting reply</p>
            <p className={`mt-1 text-3xl font-bold ${summary.unanswered > 0 ? "text-amber-600" : "text-emerald-600"}`}>
              {summary.unanswered}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {summary.unanswered > 0 ? "in the reply queue" : "all handled"}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <form onSubmit={addReview} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Log a review</h2>
          <p className="mt-1 text-xs text-slate-500">
            Use this for offline/manual reviews. Google reviews should be imported with the sync control above.
          </p>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Location
            <select
              value={manualLocationId}
              onChange={(e) => setManualLocationId(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Select a location
              </option>
              {locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {manualLocation && (
            <p className="mt-1 text-xs text-slate-500">
              Saving manual review under {manualLocation.name}.
            </p>
          )}
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Rating
            <select value={rating} onChange={(e) => setRating(Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} star{r > 1 ? "s" : ""}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Author
            <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={160} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Comment
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Log review</button>
        </form>

        <div className="space-y-3">
          {reviews.length === 0 && (
            <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
              No reviews match these filters yet.
            </div>
          )}
          {reviews.map((r) => (
            <div key={r.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <Stars n={r.rating} /> <span className="font-medium text-slate-800">{r.authorName ?? "Anonymous"}</span>
                  <span className="text-slate-400"> · {locationNameById.get(r.locationId) ?? "Unknown location"}</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Sentiment chip (design): 4★+ positive, 3★ neutral,
                      below = needs attention. */}
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      r.rating >= 4
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : r.rating === 3
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-red-200 bg-red-50 text-red-700"
                    }`}
                  >
                    {r.rating >= 4 ? "Positive" : r.rating === 3 ? "Neutral" : "Needs attention"}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      r.isGoogleSynced
                        ? "border-sky-200 bg-sky-50 text-sky-700"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    {r.isGoogleSynced ? "Google" : "Manual"}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                </div>
              </div>
              {r.comment && <p className="mt-2 text-sm text-slate-600">{r.comment}</p>}

              {r.status === "REPLIED" && r.replyText ? (
                <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  <span className="font-medium text-slate-700">Reply:</span> {r.replyText}
                </div>
              ) : (
                <div className="mt-3">
                  {drafts[r.id] === undefined ? (
                    <button onClick={() => void draft(r.id)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      Draft AI reply
                    </button>
                  ) : (
                    <div>
                      <textarea
                        value={drafts[r.id]}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                        rows={3}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => void send(r.id)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
                          {r.isGoogleSynced ? "Publish to Google" : "Save reply"}
                        </button>
                        <button onClick={() => void draft(r.id)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Regenerate</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <GmbQaPanel locationId={selectedLocationId || undefined} />
      </div>
    </DashboardShell>
  );
}
