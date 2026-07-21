"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Posts — Google Business Profile content.
//
// Lifecycle mirrors the backend: DRAFT / PENDING_APPROVAL are editable, an
// explicit approve moves a post to SCHEDULED (optionally at a time), and the
// publisher worker takes it to PUBLISHED or FAILED. Nothing publishes without
// a human approving it first.

type PostStatus = "DRAFT" | "PENDING_APPROVAL" | "SCHEDULED" | "PUBLISHED" | "FAILED";
type PostType = "UPDATE" | "OFFER" | "EVENT";

interface Post {
  id: string;
  type: PostType;
  summary: string;
  mediaUrl: string | null;
  callToActionType: string | null;
  callToActionUrl: string | null;
  locationLabel: string | null;
  scheduledAt: string | null;
  status: PostStatus;
  publishedAt: string | null;
  error: string | null;
  updatedAt: string;
}

const FILTERS: Array<{ key: "ALL" | PostStatus; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Drafts" },
  { key: "PENDING_APPROVAL", label: "Needs approval" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "PUBLISHED", label: "Published" },
  { key: "FAILED", label: "Failed" },
];

const STATUS_TONE: Record<PostStatus, "neutral" | "warn" | "brand" | "ok" | "danger"> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warn",
  SCHEDULED: "brand",
  PUBLISHED: "ok",
  FAILED: "danger",
};

const STATUS_LABEL: Record<PostStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Needs approval",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  FAILED: "Failed",
};

const TONES = ["friendly", "professional", "warm", "playful"] as const;
const TYPES: PostType[] = ["UPDATE", "OFFER", "EVENT"];

export default function GmbPostsPage() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [niches, setNiches] = useState<Array<{ key: string; label: string }>>([]);
  const [filter, setFilter] = useState<"ALL" | PostStatus>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});

  // Composer
  const [open, setOpen] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [topic, setTopic] = useState("");
  const [type, setType] = useState<PostType>("UPDATE");
  const [tone, setTone] = useState<(typeof TONES)[number]>("friendly");
  const [niche, setNiche] = useState("");
  const [summary, setSummary] = useState("");

  // Per-post schedule input
  const [scheduleAt, setScheduleAt] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.get<Post[]>("/api/v1/gmb/posts");
      setPosts(list ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load posts.");
      setPosts([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void api
      .get<Array<{ key: string; label: string }>>("/api/v1/gmb/posts/niches")
      .then((n) => setNiches(n ?? []))
      .catch(() => undefined);
    // Seed the composer's business name from the first location so the AI has
    // a real name to write with instead of a placeholder.
    void api
      .get<Array<{ name: string }>>("/api/v1/gmb/locations")
      .then((l) => setBusinessName(l?.[0]?.name ?? ""))
      .catch(() => undefined);
  }, [load]);

  const shown = useMemo(
    () => (posts ?? []).filter((p) => filter === "ALL" || p.status === filter),
    [posts, filter],
  );

  async function generate() {
    if (!businessName.trim()) return;
    setBusy((b) => ({ ...b, __gen: "1" }));
    setError(null);
    try {
      const created = await api.post<Post>("/api/v1/gmb/posts/generate", {
        businessName: businessName.trim(),
        type,
        tone,
        ...(topic.trim() ? { topic: topic.trim() } : {}),
        ...(niche ? { niche } : {}),
      });
      setSummary(created.summary);
      setTopic("");
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not generate a post.");
    } finally {
      setBusy((b) => ({ ...b, __gen: "" }));
    }
  }

  async function createManual() {
    const text = summary.trim();
    if (!text) return;
    setBusy((b) => ({ ...b, __new: "1" }));
    setError(null);
    try {
      await api.post("/api/v1/gmb/posts", { type, summary: text });
      setSummary("");
      setOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the post.");
    } finally {
      setBusy((b) => ({ ...b, __new: "" }));
    }
  }

  async function approve(id: string) {
    setBusy((b) => ({ ...b, [id]: "approve" }));
    setError(null);
    try {
      const when = scheduleAt[id];
      await api.post(`/api/v1/gmb/posts/${id}/approve`, {
        // datetime-local has no timezone; convert to a real ISO instant so the
        // worker publishes at the moment the operator actually picked.
        ...(when ? { scheduledAt: new Date(when).toISOString() } : {}),
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not approve the post.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  async function remove(id: string) {
    setBusy((b) => ({ ...b, [id]: "delete" }));
    try {
      await api.delete(`/api/v1/gmb/posts/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not delete the post.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of posts ?? []) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [posts]);

  return (
    <GmbShell title="Posts">
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Composer */}
      <Card className="mb-3.5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SectionLabel>Create a post</SectionLabel>
            <div className="mt-1 text-sm2 text-gmb-ink-muted">
              Write it yourself, or let AI draft one from a topic. Every post still
              needs your approval before it can publish.
            </div>
          </div>
          <Button variant={open ? "ghost" : "primary"} onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "New post"}
          </Button>
        </div>

        {open && (
          <div className="mt-4 border-t border-gmb-line-soft pt-4">
            <div className="grid grid-cols-4 gap-2.5">
              <label className="text-micro font-semibold uppercase tracking-wide text-gmb-ink-subtle">
                Business name
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="mt-1 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none focus:border-gmb-brand-border"
                />
              </label>
              <label className="text-micro font-semibold uppercase tracking-wide text-gmb-ink-subtle">
                Type
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as PostType)}
                  className="mt-1 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0) + t.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-micro font-semibold uppercase tracking-wide text-gmb-ink-subtle">
                Tone
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as (typeof TONES)[number])}
                  className="mt-1 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none"
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-micro font-semibold uppercase tracking-wide text-gmb-ink-subtle">
                Niche
                <select
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  className="mt-1 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none"
                >
                  <option value="">General</option>
                  {niches.map((n) => (
                    <option key={n.key} value={n.key}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-2.5 flex gap-2.5">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Topic for the AI, e.g. weekend offer on colour treatments"
                className="flex-1 rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 outline-none focus:border-gmb-brand-border"
              />
              <Button
                variant="dark"
                disabled={!businessName.trim() || busy.__gen === "1"}
                onClick={() => void generate()}
              >
                {busy.__gen === "1" ? "Generating…" : "Generate with AI"}
              </Button>
            </div>

            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              maxLength={1500}
              placeholder="Post text. Generate above to fill this in, then edit freely."
              className="mt-2.5 w-full resize-y rounded-control border border-gmb-line bg-gmb-surface p-3 text-sm2 text-gmb-ink outline-none focus:border-gmb-brand-border"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                {summary.length}/1500
              </span>
              <Button disabled={!summary.trim() || busy.__new === "1"} onClick={() => void createManual()}>
                {busy.__new === "1" ? "Saving…" : "Save as draft"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const n = f.key === "ALL" ? (posts?.length ?? 0) : (counts[f.key] ?? 0);
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

      {/* List */}
      {posts === null ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title={filter === "ALL" ? "No posts yet" : "Nothing in this filter"}
          body={
            filter === "ALL"
              ? "Create your first Google Business post above — AI can draft it from a topic."
              : "Try a different filter to see the rest."
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((p) => {
            const working = busy[p.id];
            const editable = p.status === "DRAFT" || p.status === "PENDING_APPROVAL";
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill>
                      <span className="font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle">
                        {p.type}
                      </span>
                      {p.scheduledAt && (
                        <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                          {p.status === "PUBLISHED" ? "published" : "for"}{" "}
                          {new Date(p.publishedAt ?? p.scheduledAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm2 leading-relaxed text-gmb-ink">
                      {p.summary}
                    </p>
                    {p.error && (
                      <div className="mt-2 rounded-control bg-gmb-danger-bg px-3 py-2 text-xs2 text-gmb-danger">
                        {p.error}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                    {editable && (
                      <>
                        <input
                          type="datetime-local"
                          value={scheduleAt[p.id] ?? ""}
                          onChange={(e) =>
                            setScheduleAt((s) => ({ ...s, [p.id]: e.target.value }))
                          }
                          className="rounded-control border border-gmb-line bg-gmb-surface px-2 py-1.5 font-geist-mono text-micro text-gmb-ink outline-none"
                        />
                        <div className="flex gap-1.5">
                          <Button
                            variant="ghost"
                            disabled={Boolean(working)}
                            onClick={() => void remove(p.id)}
                          >
                            Delete
                          </Button>
                          <Button disabled={Boolean(working)} onClick={() => void approve(p.id)}>
                            {working === "approve"
                              ? "Approving…"
                              : scheduleAt[p.id]
                                ? "Approve & schedule"
                                : "Approve"}
                          </Button>
                        </div>
                      </>
                    )}
                    {p.status === "SCHEDULED" && (
                      <span className="text-micro text-gmb-ink-subtle">
                        Publishes automatically
                      </span>
                    )}
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
