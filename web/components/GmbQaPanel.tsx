"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "../lib/api";

// GBP Q&A panel (Adgrowly GMB Panel — "Q&A API"). Mirrors the reviews queue:
// sync/log a question → AI draft → edit → approve → answer. Self-contained so
// it can drop into the reputation page (or its own route) with one line.
// Purple accents come from the surrounding .gmb-suite theme.

interface Question {
  id: string;
  locationId: string;
  authorName: string | null;
  questionText: string;
  askedAt: string | null;
  status: "NEW" | "ANSWERED" | "IGNORED";
  answerText: string | null;
  answeredAt: string | null;
  isFromGoogle: boolean;
  createdAt: string;
}

const STATUS_STYLE: Record<Question["status"], string> = {
  NEW: "bg-amber-50 text-amber-700",
  ANSWERED: "bg-emerald-50 text-emerald-700",
  IGNORED: "bg-slate-100 text-slate-500",
};

export function GmbQaPanel({ locationId }: { locationId?: string }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Manual "log a question" (until the GBP Q&A sync is wired to a live account).
  const [newQuestion, setNewQuestion] = useState("");
  const [newAuthor, setNewAuthor] = useState("");

  const refresh = useCallback(async () => {
    try {
      const q = locationId ? `?locationId=${locationId}` : "";
      setQuestions(await api.get<Question[]>(`/api/v1/gmb/questions${q}`));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not load questions.");
    }
  }, [locationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function logQuestion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!locationId) {
      setErr("Select a location first.");
      return;
    }
    const text = newQuestion.trim();
    if (!text) return;
    setBusy("log");
    setErr(null);
    try {
      await api.post("/api/v1/gmb/questions", {
        locationId,
        questionText: text,
        authorName: newAuthor.trim() || undefined,
      });
      setNewQuestion("");
      setNewAuthor("");
      setNotice("Question logged.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not log the question.");
    } finally {
      setBusy(null);
    }
  }

  async function draftAnswer(id: string) {
    setBusy(`draft-${id}`);
    setErr(null);
    try {
      const res = await api.post<{ answer: string; source: string }>(
        `/api/v1/gmb/questions/${id}/draft-answer`,
      );
      setDrafts((d) => ({ ...d, [id]: res.answer }));
      if (res.source === "template") {
        setNotice("AI unavailable — used a template draft. Edit before sending.");
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Draft failed.");
    } finally {
      setBusy(null);
    }
  }

  async function sendAnswer(id: string) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setBusy(`answer-${id}`);
    setErr(null);
    try {
      await api.post(`/api/v1/gmb/questions/${id}/answer`, { text });
      setDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      setNotice("Answer saved.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not save the answer.");
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(id: string, status: Question["status"]) {
    try {
      await api.patch(`/api/v1/gmb/questions/${id}`, { status });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not update status.");
    }
  }

  const openCount = questions.filter((q) => q.status === "NEW").length;

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Questions &amp; answers</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Answer public questions on your Google profile. AI drafts an answer; you approve
            it before it&apos;s posted.
          </p>
        </div>
        {openCount > 0 && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            {openCount} awaiting an answer
          </span>
        )}
      </div>

      <form onSubmit={logQuestion} className="mt-4 grid gap-2 sm:grid-cols-[1fr,180px,auto]">
        <input
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          placeholder="Log a question a customer asked…"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={newAuthor}
          onChange={(e) => setNewAuthor(e.target.value)}
          placeholder="Asked by (optional)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy === "log" || !newQuestion.trim()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "log" ? "Logging…" : "Log question"}
        </button>
      </form>

      {err && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}
      {notice && !err && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {notice}
        </div>
      )}

      {questions.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">
          No questions yet. Google-synced questions and ones you log will appear here.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {questions.map((q) => (
            <li key={q.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">
                  {q.authorName || "Someone"}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[q.status]}`}>
                  {q.status.toLowerCase()}
                </span>
                {q.isFromGoogle && (
                  <span className="rounded-full bg-[#ece8ff] px-2 py-0.5 text-[11px] font-semibold text-[#5a4af0]">
                    Google
                  </span>
                )}
                <span className="ml-auto text-[11px] text-slate-400">
                  {new Date(q.askedAt ?? q.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-slate-700">{q.questionText}</p>

              {q.status === "ANSWERED" && q.answerText ? (
                <div className="mt-2 rounded-md bg-emerald-50 p-2.5 text-sm text-emerald-800">
                  <span className="font-semibold">Your answer: </span>
                  {q.answerText}
                </div>
              ) : (
                <div className="mt-2">
                  <textarea
                    value={drafts[q.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                    placeholder="Write an answer, or use ✦ AI draft…"
                    rows={2}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void draftAnswer(q.id)}
                      disabled={busy === `draft-${q.id}`}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busy === `draft-${q.id}` ? "Drafting…" : "✦ AI draft"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendAnswer(q.id)}
                      disabled={busy === `answer-${q.id}` || !(drafts[q.id] ?? "").trim()}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busy === `answer-${q.id}` ? "Saving…" : "Approve & answer"}
                    </button>
                    {q.status === "NEW" && (
                      <button
                        type="button"
                        onClick={() => void setStatus(q.id, "IGNORED")}
                        className="text-xs text-slate-400 hover:underline"
                      >
                        Ignore
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
