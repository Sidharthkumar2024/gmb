"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Health — live status of the API process and its dependencies.
// Every value comes from the /admin/health probe at load time; Refresh re-probes.

interface Health {
  database: { status: "ok" | "error"; latencyMs: number | null; detail: string | null };
  workers: { enabled: boolean };
  uptime: number;
  node: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

export default function AdminHealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await api.get<Health>("/api/v1/admin/health"));
      setCheckedAt(new Date());
    } catch (e) {
      // If even this endpoint fails, the API itself is the unhealthy part.
      setError(
        e instanceof ApiClientError
          ? e.message
          : "The API did not respond — the server itself may be down.",
      );
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminShell title="Health">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AdmLabel>Checked</AdmLabel>
          <span className="font-geist-mono text-micro text-adm-subtle">
            {checkedAt ? checkedAt.toLocaleTimeString() : "—"}
          </span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          className="rounded-control border border-adm-line bg-adm-panel px-3.5 py-1.5 text-xs2 font-semibold text-adm-ink hover:bg-adm-panel-hover disabled:opacity-50"
        >
          {busy ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5">
        <AdmCard>
          <div className="flex items-center justify-between">
            <AdmLabel>Database</AdmLabel>
            <AdmPill tone={data ? (data.database.status === "ok" ? "ok" : "danger") : "neutral"}>
              {data ? (data.database.status === "ok" ? "Connected" : "Error") : "—"}
            </AdmPill>
          </div>
          <div className="mt-2 text-[24px] font-bold tracking-[-0.02em]">
            {data?.database.latencyMs != null ? `${data.database.latencyMs} ms` : "—"}
          </div>
          <div className="mt-1 text-xs2 text-adm-muted">
            {data?.database.detail ?? "round-trip latency of a live query"}
          </div>
        </AdmCard>

        <AdmCard>
          <div className="flex items-center justify-between">
            <AdmLabel>Background workers</AdmLabel>
            <AdmPill tone={data ? (data.workers.enabled ? "ok" : "warn") : "neutral"}>
              {data ? (data.workers.enabled ? "Enabled" : "Disabled") : "—"}
            </AdmPill>
          </div>
          <div className="mt-2 text-xs2 text-adm-muted">
            {data
              ? data.workers.enabled
                ? "Scheduled jobs (review sync, rank checks) are running in this process."
                : "WORKERS_ENABLED is off — scheduled jobs are not running."
              : "—"}
          </div>
        </AdmCard>

        <AdmCard>
          <AdmLabel>API uptime</AdmLabel>
          <div className="mt-2 text-[24px] font-bold tracking-[-0.02em]">
            {data ? formatUptime(data.uptime) : "—"}
          </div>
          <div className="mt-1 text-xs2 text-adm-muted">since the API process last started</div>
        </AdmCard>

        <AdmCard>
          <AdmLabel>Runtime</AdmLabel>
          <div className="mt-2 font-geist-mono text-[18px] font-bold tracking-[-0.01em]">
            {data ? `Node ${data.node}` : "—"}
          </div>
          <div className="mt-1 text-xs2 text-adm-muted">API server runtime version</div>
        </AdmCard>
      </div>
    </AdminShell>
  );
}
