"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Scan queue — live depth of the GMB background queues (BullMQ/Redis).
//
// Counts are read even when workers are disabled, so this shows the true
// backlog. When Redis is unreachable the API returns redisOk:false and the page
// says so rather than showing fake zeros.

interface QueueRow {
  name: string;
  label: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  error: string | null;
}

interface QueueData {
  redisOk: boolean;
  totals: { waiting: number; active: number; failed: number };
  queues: QueueRow[];
}

export default function AdminQueuePage() {
  const [data, setData] = useState<QueueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await api.get<QueueData>("/api/v1/admin/queues"));
      setCheckedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not read the queues.");
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminShell title="Scan queue">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AdmLabel>Checked</AdmLabel>
          <span className="font-geist-mono text-micro text-adm-subtle">
            {checkedAt ? checkedAt.toLocaleTimeString() : "—"}
          </span>
          {data && (
            <AdmPill tone={data.redisOk ? "ok" : "danger"}>
              {data.redisOk ? "Redis connected" : "Redis unreachable"}
            </AdmPill>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          className="rounded-control border border-adm-line bg-adm-panel px-3.5 py-1.5 text-xs2 font-semibold text-adm-ink hover:bg-adm-panel-hover disabled:opacity-50"
        >
          {busy ? "Reading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3.5">
        {(
          [
            ["Waiting", data?.totals.waiting, "neutral"],
            ["Active", data?.totals.active, "ok"],
            ["Failed", data?.totals.failed, data && data.totals.failed > 0 ? "danger" : "neutral"],
          ] as const
        ).map(([label, value, tone]) => (
          <AdmCard key={label}>
            <AdmLabel>{label}</AdmLabel>
            <div
              className={`mt-1.5 text-[28px] font-bold tracking-[-0.02em] ${
                tone === "danger" ? "text-[#ff8f85]" : tone === "ok" ? "text-adm-ok" : "text-adm-ink"
              }`}
            >
              {typeof value === "number" ? value.toLocaleString() : "—"}
            </div>
            <div className="mt-1 text-xs2 text-adm-muted">across all GMB queues</div>
          </AdmCard>
        ))}
      </div>

      <div className="mt-3.5">
        <div className="mb-2 flex items-center gap-2">
          <AdmLabel>Queues</AdmLabel>
          <span className="text-xs2 text-adm-muted">
            Live depth per background queue. Counts read from Redis; workers may be off.
          </span>
        </div>
        {data === null ? (
          <AdmCard>
            <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">reading…</div>
          </AdmCard>
        ) : (
          <AdmCard className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-adm-line">
                  {["Queue", "Waiting", "Active", "Delayed", "Failed", "Completed"].map((h) => (
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
                {data.queues.map((q) => (
                  <tr key={q.name} className="border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover">
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-semibold text-adm-ink">{q.label}</div>
                      <div className="font-geist-mono text-micro text-adm-subtle">
                        {q.error ? `error: ${q.error}` : q.name}
                      </div>
                    </td>
                    {q.error ? (
                      <td colSpan={5} className="px-4 py-3 text-xs2 text-[#ff8f85]">
                        unreadable
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">{q.waiting}</td>
                        <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-ok">{q.active}</td>
                        <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">{q.delayed}</td>
                        <td
                          className={`px-4 py-3 font-geist-mono text-xs2 ${
                            q.failed > 0 ? "text-[#ff8f85]" : "text-adm-muted"
                          }`}
                        >
                          {q.failed}
                        </td>
                        <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-subtle">{q.completed}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </AdmCard>
        )}
      </div>
    </AdminShell>
  );
}
