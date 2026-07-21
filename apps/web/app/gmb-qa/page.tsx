"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GmbShell, useActiveLocationId } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Q&A — the public-questions queue.
//
// Same approval-first shape as Reviews: AI drafts, a human approves. Google's
// Q&A write is gated behind a live connection, so an approved answer is stored
// and marked ANSWERED locally; the UI says so rather than implying it went
// live on the profile.

type QuestionStatus = "NEW" | "ANSWERED" | "IGNORED";

interface Question {
  id: string;
  locationId: string;
  authorName: string | null;
  questionText: string;
  askedAt: string | null;
  status: QuestionStatus;
  answerText: string | null;
  answeredAt: string | null;
  isFromGoogle: boolean;
  createdAt: string;
}

const FILTERS: Array<{ key: "ALL" | QuestionStatus; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "NEW", label: "Unanswered" },
  { key: "ANSWERED", label: "Answered" },
  { key: "IGNORED", label: "Ignored" },
];

export default function GmbQaPage() {
  const locationId = useActiveLocationId();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [summary, setSummary] = useState<{ total: number; unanswered: number } | null>(null);
  const [filter, setFilter] = useState<"ALL" | QuestionStatus>("ALL");
  const [error, setError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  // Ask-a-question composer (log a question heard offline / seen on the profile).
  const [asking, setAsking] = useState(false);
  const [newQ, setNewQ] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const q = locationId ? `?locationId=${locationId}` : "";
    try {
      const [list, sum] = await Promise.all([
        api.get<Question[]>(`/api/v1/gmb/questions${q}`),
        api.get<{ total: number; unanswered: number }>(`/api/v1/gmb/questions/summary${q}`),
      ]);
      setQuestions(list ?? []);
      setSummary(sum);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load questions.");
      setQuestions([]);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () => (questions ?? []).filter((q) => filter === "ALL" || q.status === filter),
    [questions, filter],
  );

  async function draft(id: string) {
    setBusy((b) => ({ ...b, [id]: "draft" }));
    setError(null);
    try {
      const d = await api.post<{ answer: string; source: "ai" | "template" }>(
        `/api/v1/gmb/questions/${id}/draft-answer`,
        {},
      );
      setDrafts((s) => ({ ...s, [id]: d.answer }));
      setOpenId(id);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not generate a draft.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  async function answer(id: string) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setBusy((b) => ({ ...b, [id]: "answer" }));
    setError(null);
    try {
      await api.post(`/api/v1/gmb/questions/${id}/answer`, { text });
      setDrafts((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
      setOpenId(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the answer.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  async function setStatus(id: string, status: QuestionStatus) {
    setBusy((b) => ({ ...b, [id]: "status" }));
    try {
      await api.patch(`/api/v1/gmb/questions/${id}`, { status });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update the question.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  async function logQuestion() {
    const text = newQ.trim();
    if (!text || !locationId) return;
    setBusy((b) => ({ ...b, __new: "log" }));
    setError(null);
    try {
      await api.post("/api/v1/gmb/questions", { locationId, questionText: text });
      setNewQ("");
      setAsking(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not log the question.");
    } finally {
      setBusy((b) => ({ ...b, __new: "" }));
    }
  }

  return (
    <GmbShell title="Q&A">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-3.5 grid grid-cols-4 gap-3.5">
        <Card>
          <SectionLabel>Questions</SectionLabel>
          <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
            {summary?.total ?? "—"}
          </div>
          <div className="mt-1 text-xs2 text-gmb-ink-muted">on this profile</div>
        </Card>
        <Card>
          <SectionLabel>Unanswered</SectionLabel>
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
          <SectionLabel>Log a question</SectionLabel>
          <div className="mt-2 text-xs2 text-gmb-ink-muted">
            Heard a question in person or on the profile? Add it here so the answer
            is on record and searchable.
          </div>
          <div className="mt-2.5">
            {asking ? (
              <div className="flex gap-1.5">
                <input
                  value={newQ}
                  onChange={(e) => setNewQ(e.target.value)}
                  placeholder="e.g. Do you take walk-ins on Sundays?"
                  className="flex-1 rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 outline-none focus:border-gmb-brand-border"
                />
                <Button
                  disabled={!newQ.trim() || !locationId || busy.__new === "log"}
                  onClick={() => void logQuestion()}
                >
                  {busy.__new === "log" ? "Saving…" : "Add"}
                </Button>
                <Button variant="ghost" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setAsking(true)} disabled={!locationId}>
                Add a question
              </Button>
            )}
          </div>
        </Card>
      </div>

      <div className="mb-3 flex gap-1.5">
        {FILTERS.map((f) => {
          const n =
            f.key === "ALL"
              ? (questions?.length ?? 0)
              : (questions ?? []).filter((q) => q.status === f.key).length;
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

      {questions === null ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title={filter === "ALL" ? "No questions yet" : "Nothing in this filter"}
          body={
            filter === "ALL"
              ? "Questions asked on your Google profile appear here once a connection is live. You can also log one manually above."
              : "Try a different filter to see the rest of the queue."
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((q) => {
            const isOpen = openId === q.id;
            const working = busy[q.id];
            return (
              <Card key={q.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold">
                        {q.authorName || "Someone on Google"}
                      </span>
                      <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                        {new Date(q.askedAt ?? q.createdAt).toLocaleDateString()}
                      </span>
                      {q.status === "ANSWERED" && <Pill tone="ok">Answered</Pill>}
                      {q.status === "IGNORED" && <Pill>Ignored</Pill>}
                      {!q.isFromGoogle && <Pill>Logged manually</Pill>}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm2 leading-relaxed text-gmb-ink">
                      {q.questionText}
                    </p>
                    {q.answerText && (
                      <div className="mt-2.5 rounded-control border-l-2 border-gmb-brand bg-gmb-brand-wash px-3 py-2">
                        <div className="font-geist-mono text-micro uppercase tracking-wide text-gmb-brand">
                          Your answer
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm2 text-gmb-ink-muted">
                          {q.answerText}
                        </p>
                      </div>
                    )}
                  </div>

                  {q.status !== "ANSWERED" && (
                    <div className="flex flex-shrink-0 gap-1.5">
                      <Button
                        variant="ghost"
                        disabled={Boolean(working)}
                        onClick={() => void draft(q.id)}
                      >
                        {working === "draft" ? "Drafting…" : "AI draft"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={Boolean(working)}
                        onClick={() => {
                          setOpenId(isOpen ? null : q.id);
                          setDrafts((s) => ({ ...s, [q.id]: s[q.id] ?? "" }));
                        }}
                      >
                        {isOpen ? "Close" : "Write"}
                      </Button>
                    </div>
                  )}
                </div>

                {isOpen && q.status !== "ANSWERED" && (
                  <div className="mt-3 border-t border-gmb-line-soft pt-3">
                    <textarea
                      value={drafts[q.id] ?? ""}
                      onChange={(e) => setDrafts((s) => ({ ...s, [q.id]: e.target.value }))}
                      rows={4}
                      maxLength={1000}
                      placeholder="Answer in your own words, or generate a draft and edit it."
                      className="w-full resize-y rounded-control border border-gmb-line bg-gmb-surface p-3 text-sm2 text-gmb-ink outline-none focus:border-gmb-brand-border"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                        {(drafts[q.id] ?? "").length}/1000 · saved here; posts to Google once
                        your Business Profile connection is live
                      </span>
                      <div className="flex gap-1.5">
                        <Button
                          variant="ghost"
                          disabled={Boolean(working)}
                          onClick={() => void setStatus(q.id, "IGNORED")}
                        >
                          Ignore
                        </Button>
                        <Button
                          disabled={Boolean(working) || !(drafts[q.id] ?? "").trim()}
                          onClick={() => void answer(q.id)}
                        >
                          {working === "answer" ? "Saving…" : "Approve & answer"}
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
