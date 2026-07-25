"use client";

// Tickets — the partner's own support threads with Adgrowly. Reuses the same
// tenant-scoped /support/tickets API the Suite uses: a partner tenant is a
// tenant, so its tickets flow into the same staff queue on the admin side.

import { useCallback, useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

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
  "w-full rounded-control border border-ptn-line bg-ptn-bg px-3 py-2 text-sm2 text-ptn-ink outline-none placeholder:text-ptn-subtle focus:border-ptn-accent";

export default function PartnerSupportPage() {
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

  if (openId) {
    return (
      <PartnerShell title="Tickets">
        {error && (
          <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setOpenId(null);
            setDetail(null);
          }}
          className="mb-3 text-sm2 text-ptn-accent hover:underline"
        >
          ← All tickets
        </button>
        {detail === null ? (
          <PtnCard>
            <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
          </PtnCard>
        ) : (
          <div className="flex max-w-[760px] flex-col gap-3.5">
            <PtnCard>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-semibold text-ptn-ink">{detail.subject}</div>
                  <div className="mt-1 font-geist-mono text-micro text-ptn-subtle">
                    Opened {new Date(detail.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <PtnPill tone={PRIORITY_TONE[detail.priority]}>{detail.priority}</PtnPill>
                  <PtnPill tone={STATUS_TONE[detail.status]}>{detail.status}</PtnPill>
                </div>
              </div>
            </PtnCard>

            <div className="flex flex-col gap-2.5">
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-card border px-4 py-3 ${
                    m.author === "STAFF"
                      ? "border-ptn-accent/40 bg-ptn-accent/10"
                      : "border-ptn-line bg-ptn-panel"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs2 font-semibold text-ptn-ink">
                      {m.author === "STAFF" ? "Adgrowly support" : "You"}
                    </span>
                    <span className="font-geist-mono text-micro text-ptn-subtle">
                      {new Date(m.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm2 leading-relaxed text-ptn-muted">
                    {m.body}
                  </p>
                </div>
              ))}
            </div>

            {detail.status !== "CLOSED" && (
              <PtnCard>
                <form onSubmit={submitReply} className="flex flex-col gap-2">
                  <PtnLabel>Reply</PtnLabel>
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} placeholder="Type your reply…" className={inputCls} />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={busy || !reply.trim()}
                      className="rounded-control bg-ptn-accent px-4 py-2 text-sm2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover disabled:opacity-50"
                    >
                      {busy ? "Sending…" : "Send reply"}
                    </button>
                  </div>
                </form>
              </PtnCard>
            )}
          </div>
        )}
      </PartnerShell>
    );
  }

  return (
    <PartnerShell title="Tickets">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}

      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-sm2 text-ptn-muted">
          Your agency&rsquo;s tickets with Adgrowly — partner questions, escalations, requests.
        </span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-control bg-ptn-accent px-4 py-2 text-sm2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover"
        >
          {creating ? "Cancel" : "New ticket"}
        </button>
      </div>

      {creating && (
        <PtnCard className="mb-3.5">
          <form onSubmit={submitNew} className="flex flex-col gap-3">
            <PtnLabel>New ticket</PtnLabel>
            <div className="grid grid-cols-[1fr_160px] gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-ptn-subtle">Subject</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} required className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-ptn-subtle">Priority</span>
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
              <span className="text-micro uppercase tracking-wide text-ptn-subtle">Message</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} required className={inputCls} />
            </label>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy || !subject.trim() || !body.trim()}
                className="rounded-control bg-ptn-accent px-4 py-2 text-sm2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover disabled:opacity-50"
              >
                {busy ? "Creating…" : "Open ticket"}
              </button>
            </div>
          </form>
        </PtnCard>
      )}

      {tickets === null ? (
        <PtnCard>
          <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
        </PtnCard>
      ) : tickets.length === 0 ? (
        <PtnCard>
          <div className="py-8 text-center text-sm2 text-ptn-muted">
            No tickets yet. Open one and Adgrowly support replies here.
          </div>
        </PtnCard>
      ) : (
        <div className="flex flex-col gap-2.5">
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void openTicket(t.id)}
              className="w-full rounded-card border border-ptn-line bg-ptn-panel px-4 py-3 text-left transition hover:border-ptn-accent/50"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm2 font-semibold text-ptn-ink">{t.subject}</span>
                <div className="flex flex-shrink-0 gap-1.5">
                  <PtnPill tone={PRIORITY_TONE[t.priority]}>{t.priority}</PtnPill>
                  <PtnPill tone={STATUS_TONE[t.status]}>{t.status}</PtnPill>
                </div>
              </div>
              <div className="mt-1 font-geist-mono text-micro text-ptn-subtle">
                {t.lastReplyBy === "STAFF" ? "Adgrowly replied" : "You replied"} ·{" "}
                {new Date(t.lastReplyAt).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      )}
    </PartnerShell>
  );
}
