"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Tickets — every workspace's support tickets. Staff reply as Adgrowly and set
// status/priority. Reads span all tenants; replies + status changes are audited.

type Status = "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type Author = "CUSTOMER" | "STAFF";

interface TicketRow {
  id: string;
  tenantName?: string;
  subject: string;
  status: Status;
  priority: Priority;
  lastReplyAt: string;
  lastReplyBy: Author;
  createdAt: string;
  messageCount?: number;
  assignedToUserId: string | null;
}
interface Message {
  id: string;
  author: Author;
  body: string;
  createdAt: string;
  internal: boolean;
}
interface TicketDetail extends TicketRow {
  messages: Message[];
}
interface Assignee { id: string; name: string | null; email: string }

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
const STATUSES: Status[] = ["OPEN", "PENDING", "RESOLVED", "CLOSED"];
const FILTERS: Array<"ALL" | Status> = ["ALL", "OPEN", "PENDING", "RESOLVED", "CLOSED"];
const inputCls =
  "rounded-control border border-adm-line bg-adm-bg px-3 py-2 text-sm2 text-adm-ink outline-none focus:border-gmb-brand";

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [filter, setFilter] = useState<"ALL" | Status>("ALL");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [internal, setInternal] = useState(false);
  const [assignees, setAssignees] = useState<Assignee[]>([]);

  useEffect(() => {
    void api.get<Assignee[]>("/api/v1/admin/tickets/assignees").then((rows) => setAssignees(rows ?? [])).catch(() => undefined);
  }, []);

  const loadList = useCallback(async (f: "ALL" | Status) => {
    setError(null);
    try {
      const qs = f === "ALL" ? "" : `?status=${f}`;
      setTickets((await api.get<TicketRow[]>(`/api/v1/admin/tickets${qs}`)) ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load tickets.");
      setTickets([]);
    }
  }, []);

  useEffect(() => {
    void loadList(filter);
  }, [loadList, filter]);

  const openTicket = useCallback(async (id: string) => {
    setOpenId(id);
    setDetail(null);
    setError(null);
    try {
      setDetail(await api.get<TicketDetail>(`/api/v1/admin/tickets/${id}`));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load the ticket.");
      setOpenId(null);
    }
  }, []);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!openId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setDetail(await api.post<TicketDetail>(`/api/v1/admin/tickets/${openId}/reply`, {
        body: reply.trim(),
        internal,
      }));
      setReply("");
      setInternal(false);
      await loadList(filter);
    } catch (e2) {
      setError(e2 instanceof ApiClientError ? e2.message : "Could not send the reply.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: { status?: Status; priority?: Priority; assignedToUserId?: string | null }) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<TicketDetail>(`/api/v1/admin/tickets/${id}`, body);
      setDetail((d) => (d ? {
        ...d,
        status: updated.status,
        priority: updated.priority,
        assignedToUserId: updated.assignedToUserId,
      } : d));
      await loadList(filter);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update the ticket.");
    } finally {
      setBusy(false);
    }
  }

  if (openId) {
    return (
      <AdminShell title="Tickets">
        {error && (
          <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setOpenId(null);
            setDetail(null);
          }}
          className="mb-3 text-sm2 text-adm-accent hover:underline"
        >
          ← All tickets
        </button>
        {detail === null ? (
          <AdmCard>
            <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
          </AdmCard>
        ) : (
          <div className="flex max-w-[820px] flex-col gap-3.5">
            <AdmCard>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-semibold text-adm-ink">{detail.subject}</div>
                  <div className="mt-1 font-geist-mono text-micro text-adm-subtle">
                    {detail.tenantName} · opened {new Date(detail.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Assignee"
                    value={detail.assignedToUserId ?? ""}
                    disabled={busy}
                    onChange={(e) => void patch(detail.id, { assignedToUserId: e.target.value || null })}
                    className={inputCls}
                  >
                    <option value="">Unassigned</option>
                    {assignees.map((user) => (
                      <option key={user.id} value={user.id}>{user.name || user.email}</option>
                    ))}
                  </select>
                  <select
                    value={detail.priority}
                    disabled={busy}
                    onChange={(e) => void patch(detail.id, { priority: e.target.value as Priority })}
                    className={inputCls}
                  >
                    {(["LOW", "NORMAL", "HIGH", "URGENT"] as Priority[]).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <select
                    value={detail.status}
                    disabled={busy}
                    onChange={(e) => void patch(detail.id, { status: e.target.value as Status })}
                    className={inputCls}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </AdmCard>

            <div className="flex flex-col gap-2.5">
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-card border px-4 py-3 ${
                    m.internal
                      ? "border-adm-line bg-adm-bg"
                      : m.author === "STAFF"
                      ? "border-gmb-brand/40 bg-gmb-brand/10"
                      : "border-adm-line bg-adm-panel"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs2 font-semibold text-adm-ink">
                      {m.internal ? "Internal note" : m.author === "STAFF" ? "You (Adgrowly)" : detail.tenantName ?? "Customer"}
                    </span>
                    <span className="font-geist-mono text-micro text-adm-subtle">
                      {new Date(m.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm2 leading-relaxed text-adm-muted">
                    {m.body}
                  </p>
                </div>
              ))}
            </div>

            <AdmCard>
              <form onSubmit={sendReply} className="flex flex-col gap-2">
                <AdmLabel>{internal ? "Internal note" : "Reply as Adgrowly"}</AdmLabel>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={4}
                  placeholder="Type your reply…"
                  className={`${inputCls} w-full`}
                />
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs2 text-adm-muted">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                    Staff-only note (not emailed or shown to customer)
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !reply.trim()}
                    className="rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white hover:bg-gmb-brand-hover disabled:opacity-50"
                  >
                    {busy ? "Saving…" : internal ? "Add note" : "Send reply"}
                  </button>
                </div>
              </form>
            </AdmCard>
          </div>
        )}
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Tickets">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="mb-3 flex gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-xs2 font-semibold transition ${
              filter === f
                ? "bg-gmb-brand text-white"
                : "border border-adm-line bg-adm-panel text-adm-muted hover:bg-adm-panel-hover"
            }`}
          >
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {tickets === null ? (
        <AdmCard>
          <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        </AdmCard>
      ) : tickets.length === 0 ? (
        <AdmCard>
          <div className="py-8 text-center text-sm2 text-adm-muted">No tickets in this view.</div>
        </AdmCard>
      ) : (
        <AdmCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-adm-line">
                {["Subject", "Workspace", "Priority", "Status", "Last reply"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-adm-subtle"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => void openTicket(t.id)}
                  className="cursor-pointer border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover"
                >
                  <td className="px-4 py-3">
                    <div className="text-[13px] font-semibold text-adm-ink">{t.subject}</div>
                    {t.messageCount != null && (
                      <div className="font-geist-mono text-micro text-adm-subtle">
                        {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs2 text-adm-muted">{t.tenantName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <AdmPill tone={PRIORITY_TONE[t.priority]}>{t.priority}</AdmPill>
                  </td>
                  <td className="px-4 py-3">
                    <AdmPill tone={STATUS_TONE[t.status]}>{t.status}</AdmPill>
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-micro text-adm-subtle">
                    {t.lastReplyBy === "STAFF" ? "staff" : "customer"} ·{" "}
                    {new Date(t.lastReplyAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdmCard>
      )}
    </AdminShell>
  );
}
