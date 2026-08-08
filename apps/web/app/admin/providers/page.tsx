"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Integrations (Providers & keys) — a consolidated "is the platform wired up?"
// board. Read-only and secret-free: the API returns configured booleans and
// safe identifiers only, never key values. Each row links to its config screen.

interface Integration {
  key: string;
  name: string;
  purpose: string;
  configured: boolean;
  detail: string;
  manageHref: string | null;
}

export default function AdminProvidersPage() {
  const [rows, setRows] = useState<Integration[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<{ integrations: Integration[] }>("/api/v1/admin/integrations")
      .then((d) => setRows(d.integrations))
      .catch((e) =>
        setError(e instanceof ApiClientError ? e.message : "Could not load integrations."),
      );
  }, []);

  return (
    <AdminShell title="Providers & keys">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="mb-3.5 flex items-center gap-2">
        <AdmLabel>Scope</AdmLabel>
        <span className="text-xs2 text-adm-muted">
          Platform-wide integration status. Secrets never leave the server — this shows only whether
          each is configured. Manage keys on each integration’s own screen.
        </span>
      </div>

      {rows === null ? (
        <AdmCard>
          <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        </AdmCard>
      ) : (
        <div className="grid grid-cols-2 gap-3.5">
          {rows.map((r) => (
            <AdmCard key={r.key}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-adm-ink">{r.name}</div>
                  <div className="mt-0.5 text-xs2 text-adm-muted">{r.purpose}</div>
                </div>
                <AdmPill tone={r.configured ? "ok" : "warn"}>
                  {r.configured ? "Configured" : "Not configured"}
                </AdmPill>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-adm-line pt-3">
                <span className="break-all font-geist-mono text-micro text-adm-subtle">
                  {r.detail}
                </span>
                {r.manageHref ? (
                  <Link href={r.manageHref} className="flex-shrink-0 no-underline hover:no-underline">
                    <span className="inline-block rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-medium text-adm-ink hover:bg-adm-panel-hover">
                      Manage
                    </span>
                  </Link>
                ) : (
                  <span className="flex-shrink-0 text-micro text-adm-subtle">env-only</span>
                )}
              </div>
            </AdmCard>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
