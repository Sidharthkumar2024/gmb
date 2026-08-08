"use client";

// Support — the workspace raises tickets and talks to Adgrowly staff. A ticket
// is a thread: you open it with a subject + message, staff reply, you reply
// back. Everything here is your workspace's own tickets only.

import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

type Status = "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type Author = "CUSTOMER" | "STAFF";

interface TicketRow {
  id: string;
  subject: string;
  status: Status;
  priority: Priority;
  lastReplyAt: string;
  lastReplyBy: Author;
  createdAt: string;
  messageCount?: number;
}
interface Message {
  id: string;
  author: Author;
  body: string;
  createdAt: string;
}
interface TicketDetail extends TicketRow {
  messages: Message[];
}

const STATUS_TONE: Record<Status, "ok" | "warn" | "neutral"> = {
  OPEN: "warn",
  PENDING: "warn",
  RESOLVED: "ok",
  CLOSED: "neutral",
};
const PRIORITY_TONE: Record<Priority, "danger" | "warn" | "neutral"> = {
  URGENT: "danger",
  HIGH: "danger",
  NORMAL: "neutral",
  LOW: "neutral",
};
const inputCls =
  "w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 text-gmb-ink outline-none placeholder:text-gmb-ink-subtle focus:border-gmb-brand";

export default function GmbSupportPage() {
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");

  const loadList = useCallback(async () => {
    setError(null);
    try {
      setTickets((await api.get<TicketRow[]>("/api/v1/support/tickets")) ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load tickets.");
      setTickets([]);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openTicket = useCallback(async (id: string) => {
    setOpenId(id);
    setDetail(null);
    setError(null);
    try {
      setDetail(await api.get<TicketDetail>(`/api/v1/support/tickets/${id}`));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load the ticket.");
      setOpenId(null);
    }
  }, []);

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await api.post<TicketDetail>("/api/v1/support/tickets", {
        subject: subject.trim(),
        body: body.trim(),
        priority,
      });
      setSubject("");
      setBody("");
      setPriority("NORMAL");
      setCreating(false);
      await loadList();
      void openTicket(t.id);
    } catch (e2) {
      setError(e2 instanceof ApiClientError ? e2.message : "Could not create the ticket.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!openId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setDetail(await api.post<TicketDetail>(`/api/v1/support/tickets/${openId}/reply`, { body: reply.trim() }));
      setReply("");
      await loadList();
    } catch (e2) {
      setError(e2 instanceof ApiClientError ? e2.message : "Could not send the reply.");
    } finally {
      setBusy(false);
    }
  }

  // Detail view
  if (openId) {
    return (
      <GmbShell title="My tickets">
        {error && <ErrorNote>{error}</ErrorNote>}
        <button
          type="button"
          onClick={() => {
            setOpenId(null);
            setDetail(null);
          }}
          className="mb-3 text-sm2 text-gmb-brand hover:underline"
        >
          ← All tickets
        </button>
        {detail === null ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="flex max-w-[760px] flex-col gap-3.5">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-semibold text-gmb-ink">{detail.subject}</div>
                  <div className="mt-1 font-geist-mono text-micro text-gmb-ink-subtle">
                    Opened {new Date(detail.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Pill tone={PRIORITY_TONE[detail.priority]}>{detail.priority}</Pill>
                  <Pill tone={STATUS_TONE[detail.status]}>{detail.status}</Pill>
                </div>
              </div>
            </Card>

            <div className="flex flex-col gap-2.5">
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-panel border px-4 py-3 ${
                    m.author === "STAFF"
                      ? "border-gmb-brand-border bg-gmb-brand-wash"
                      : "border-gmb-line bg-gmb-surface"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs2 font-semibold text-gmb-ink">
                      {m.author === "STAFF" ? "Adgrowly support" : "You"}
                    </span>
                    <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                      {new Date(m.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm2 leading-relaxed text-gmb-ink-muted">
                    {m.body}
                  </p>
                </div>
              ))}
            </div>

            {detail.status !== "CLOSED" && (
              <Card>
                <form onSubmit={submitReply} className="flex flex-col gap-2">
                  <SectionLabel>Reply</SectionLabel>
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={4}
                    placeholder="Type your reply…"
                    className={inputCls}
                  />
                  <div className="flex justify-end">
                    <Button type="submit" disabled={busy || !reply.trim()}>
                      {busy ? "Sending…" : "Send reply"}
                    </Button>
                  </div>
                </form>
              </Card>
            )}
          </div>
        )}
      </GmbShell>
    );
  }

  // List view
  return (
    <GmbShell title="My tickets">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-sm2 text-gmb-ink-muted">
          Questions or issues? Open a ticket and Adgrowly support will reply here.
        </span>
        <Button onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New ticket"}</Button>
      </div>

      {creating && (
        <Card className="mb-3.5">
          <form onSubmit={submitNew} className="flex flex-col gap-3">
            <SectionLabel>New ticket</SectionLabel>
            <div className="grid grid-cols-[1fr_160px] gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Subject</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} required className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Priority</span>
                <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={inputCls}>
                  {(["LOW", "NORMAL", "HIGH", "URGENT"] as Priority[]).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-gmb-ink-subtle">Message</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} required className={inputCls} />
            </label>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || !subject.trim() || !body.trim()}>
                {busy ? "Creating…" : "Open ticket"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {tickets === null ? (
        <Skeleton className="h-40" />
      ) : tickets.length === 0 ? (
        <EmptyState
          title="No tickets yet"
          body="When you open a support ticket it appears here with Adgrowly's replies."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void openTicket(t.id)}
              className="w-full rounded-panel border border-gmb-line bg-gmb-surface px-4 py-3 text-left transition hover:border-gmb-brand-border"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm2 font-semibold text-gmb-ink">{t.subject}</span>
                <div className="flex flex-shrink-0 gap-1.5">
                  <Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill>
                  <Pill tone={STATUS_TONE[t.status]}>{t.status}</Pill>
                </div>
              </div>
              <div className="mt-1 font-geist-mono text-micro text-gmb-ink-subtle">
                {t.lastReplyBy === "STAFF" ? "Adgrowly replied" : "You replied"} ·{" "}
                {new Date(t.lastReplyAt).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      )}
    </GmbShell>
  );
}
