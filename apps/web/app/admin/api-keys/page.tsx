"use client";

import { useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface ApiKeyStatus { issuanceEnabled: boolean; items: unknown[]; reason: string; }

export default function AdminApiKeysPage() {
  const [data, setData] = useState<ApiKeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api.get<ApiKeyStatus>("/api/v1/admin/api-keys").then(setData).catch((reason) => setError(reason instanceof ApiClientError ? reason.message : "Could not load API-key status.")); }, []);
  return (
    <AdminShell title="API keys">
      {error ? <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">{error}</div> : null}
      <div className="mb-4 flex items-center gap-2"><span className="text-[13px] text-adm-muted">Platform API keys issued to accounts & integrations</span><div className="flex-1"/><button type="button" disabled className="rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">+ Create API key</button></div>
      <AdmCard>
        <div className="flex items-start justify-between gap-4"><div><AdmLabel>Public API access</AdmLabel><div className="mt-2 text-[15px] font-semibold text-adm-ink">No keys issued</div><p className="mt-1 max-w-[720px] text-xs2 leading-relaxed text-adm-muted">{data?.reason ?? "Checking whether scoped API-key access is available…"}</p></div><AdmPill tone={data?.issuanceEnabled ? "ok" : "warn"}>{data?.issuanceEnabled ? "Enabled" : "Disabled"}</AdmPill></div>
      </AdmCard>
      <div className="mt-3 text-xs2 text-adm-subtle">Provider credentials belong in Providers & keys or the dedicated Google, AI, payment, SMTP and storage screens. They are encrypted in the Secret Vault and are not integration API keys.</div>
    </AdminShell>
  );
}
