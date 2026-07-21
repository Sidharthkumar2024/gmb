"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GmbShell, useActiveLocationId } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Reviews — the reply queue.
//
// Approval-first by design, matching the backend: AI produces a draft, a human
// edits and approves, and only then is a reply recorded. Nothing is ever posted
// automatically. `isGoogleSynced` is surfaced honestly so the operator knows
// whether a reply will reach Google or stay local.

type ReviewStatus = "NEW" | "REPLIED" | "FLAGGED";

interface Review {
  id: string;
  locationId: string;
  authorName: string;
  rating: number;
  comment: string | null;
  reviewedAt: string;
  status: ReviewStatus;
  replyText: string | null;
  repliedAt: string | null;
  isGoogleSynced: boolean;
}

interface Summary {
  count: number;
  average: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  unanswered: number;
}

const FILTERS: Array<{ key: "ALL" | ReviewStatus; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "NEW", label: "Needs reply" },
  { key: "REPLIED", label: "Replied" },
  { key: "FLAGGED", label: "Flagged" },
];

function Stars({ rating }: { rating: number }) {
  return (
    <span
      className="font-geist-mono text-xs2"
      style={{ color: rating >= 4 ? "#16803c" : rating >= 3 ? "#b25e09" : "#d92d20" }}
      aria-label={`${rating} out of 5`}
    >
      {"★".repeat(rating)}
      <span className="text-gmb-line">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export default function GmbReviewsPage() {
  const locationId = useActiveLocationId();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<"ALL" | ReviewStatus>("ALL");
  const [error, setError] = useState<string | null>(null);

  // Per-review editor state, keyed by id so two open drafts never collide.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const loc = locationId ? `locationId=${locationId}` : "";
    try {
      const [list, sum] = await Promise.all([
        api.get<Review[]>(`/api/v1/gmb/reviews${loc ? `?${loc}` : ""}`),
        api.get<Summary>(`/api/v1/gmb/reviews/summary${loc ? `?${loc}` : ""}`),
      ]);
      setReviews(list ?? []);
      setSummary(sum);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load reviews.");
      setReviews([]);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () => (reviews ?? []).filter((r) => filter === "ALL" || r.status === filter),
    [reviews, filter],
  );

  async function draft(id: string, tone: "warm" | "professional") {
    setBusy((b) => ({ ...b, [id]: "draft" }));
    setError(null);
    try {
      const d = await api.post<{ reply: string; source: "ai" | "template" }>(
        `/api/v1/gmb/reviews/${id}/draft-reply`,
        { tone },
      );
      setDrafts((s) => ({ ...s, [id]: d.reply }));
      setOpenId(id);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not generate a draft.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  async function send(id: string) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setBusy((b) => ({ ...b, [id]: "send" }));
    setError(null);
    try {
      await api.post(`/api/v1/gmb/reviews/${id}/reply`, { text });
      setDrafts((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
      setOpenId(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the reply.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  async function setStatus(id: string, status: ReviewStatus) {
    setBusy((b) => ({ ...b, [id]: "status" }));
    try {
      await api.patch(`/api/v1/gmb/reviews/${id}`, { status });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update the review.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  return (
    <GmbShell title="Reviews">
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Summary strip */}
      <div className="mb-3.5 grid grid-cols-4 gap-3.5">
        <Card>
          <SectionLabel>Average rating</SectionLabel>
          <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
            {summary && summary.count > 0 ? summary.average.toFixed(1) : "—"}
          </div>
          <div className="mt-1 text-xs2 text-gmb-ink-muted">
            {summary ? `${summary.count} review${summary.count === 1 ? "" : "s"}` : " "}
          </div>
        </Card>
        <Card>
          <SectionLabel>Needs reply</SectionLabel>
          <div
            className={`mt-1.5 text-[28px] font-bold tracking-[-0.02em] ${
              summary?.unanswered ? "text-gmb-warn" : "text-gmb-ok"
            }`}
          >
            {summary?.unanswered ?? "—"}
          </div>
          <div className="mt-1 text-xs2 text-gmb-ink-muted">
            {summary?.unanswered ? "waiting on you" : "all clear"}
          </div>
        </Card>
        <Card className="col-span-2">
          <SectionLabel>Rating spread</SectionLabel>
          <div className="mt-2.5 flex flex-col gap-1">
            {([5, 4, 3, 2, 1] as const).map((star) => {
              const n = summary?.distribution?.[String(star) as "5"] ?? 0;
              const pct = summary && summary.count > 0 ? (n / summary.count) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-2">
                  <span className="w-3 font-geist-mono text-micro text-gmb-ink-subtle">{star}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gmb-line-soft">
                    <div
                      className="h-full rounded-full bg-gmb-brand"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-geist-mono text-micro text-gmb-ink-subtle">
                    {n}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-3 flex gap-1.5">
        {FILTERS.map((f) => {
          const n =
            f.key === "ALL"
              ? (reviews?.length ?? 0)
              : (reviews ?? []).filter((r) => r.status === f.key).length;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs2 font-semibold transition ${
                filter === f.key
                  ? "bg-gmb-brand text-white"
                  : "border border-gmb-line bg-gmb-surface text-gmb-ink-muted hover:border-gmb-brand-border"
              }`}
            >
              {f.label} {n > 0 && <span className="opacity-70">{n}</span>}
            </button>
          );
        })}
      </div>

      {/* Queue */}
      {reviews === null ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title={filter === "ALL" ? "No reviews yet" : "Nothing in this filter"}
          body={
            filter === "ALL"
              ? "Connect a Google Business Profile and reviews will sync here automatically."
              : "Try a different filter to see the rest of the queue."
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((r) => {
            const isOpen = openId === r.id;
            const working = busy[r.id];
            return (
              <Card key={r.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold">{r.authorName}</span>
                      <Stars rating={r.rating} />
                      <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                        {new Date(r.reviewedAt).toLocaleDateString()}
                      </span>
                      {r.status === "REPLIED" && <Pill tone="ok">Replied</Pill>}
                      {r.status === "FLAGGED" && <Pill tone="danger">Flagged</Pill>}
                      {!r.isGoogleSynced && <Pill>Local only</Pill>}
                    </div>
                    {r.comment && (
                      <p className="mt-2 whitespace-pre-wrap text-sm2 leading-relaxed text-gmb-ink-muted">
                        {r.comment}
                      </p>
                    )}
                    {r.replyText && (
                      <div className="mt-2.5 rounded-control border-l-2 border-gmb-brand bg-gmb-brand-wash px-3 py-2">
                        <div className="font-geist-mono text-micro uppercase tracking-wide text-gmb-brand">
                          Your reply
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm2 text-gmb-ink-muted">
                          {r.replyText}
                        </p>
                      </div>
                    )}
                  </div>

                  {r.status !== "REPLIED" && (
                    <div className="flex flex-shrink-0 gap-1.5">
                      <Button
                        variant="ghost"
                        disabled={Boolean(working)}
                        onClick={() => void draft(r.id, "warm")}
                      >
                        {working === "draft" ? "Drafting…" : "AI draft"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={Boolean(working)}
                        onClick={() => {
                          setOpenId(isOpen ? null : r.id);
                          setDrafts((s) => ({ ...s, [r.id]: s[r.id] ?? "" }));
                        }}
                      >
                        {isOpen ? "Close" : "Write"}
                      </Button>
                    </div>
                  )}
                </div>

                {isOpen && r.status !== "REPLIED" && (
                  <div className="mt-3 border-t border-gmb-line-soft pt-3">
                    <textarea
                      value={drafts[r.id] ?? ""}
                      onChange={(e) => setDrafts((s) => ({ ...s, [r.id]: e.target.value }))}
                      rows={4}
                      maxLength={1500}
                      placeholder="Write a reply, or generate a draft and edit it."
                      className="w-full resize-y rounded-control border border-gmb-line bg-gmb-surface p-3 text-sm2 text-gmb-ink outline-none focus:border-gmb-brand-border"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                        {(drafts[r.id] ?? "").length}/1500
                        {r.isGoogleSynced
                          ? " · publishes to Google"
                          : " · saved locally (not synced from Google)"}
                      </span>
                      <div className="flex gap-1.5">
                        <Button
                          variant="ghost"
                          disabled={Boolean(working)}
                          onClick={() => void draft(r.id, "professional")}
                        >
                          Professional tone
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={Boolean(working)}
                          onClick={() => void setStatus(r.id, "FLAGGED")}
                        >
                          Flag
                        </Button>
                        <Button
                          disabled={Boolean(working) || !(drafts[r.id] ?? "").trim()}
                          onClick={() => void send(r.id)}
                        >
                          {working === "send" ? "Saving…" : "Approve & reply"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </GmbShell>
  );
}
