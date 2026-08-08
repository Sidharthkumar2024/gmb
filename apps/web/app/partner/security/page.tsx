"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";
import { useAuth } from "../../../src/hooks/useAuth";

interface SecurityView { email: string | null; emailVerified: boolean; lastLoginAt: string | null; passwordUpdatedAt: string | null; activeSessions: number; twoFactorAvailable: boolean; }

export default function PartnerSecurityPage() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [data, setData] = useState<SecurityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.get<SecurityView>("/api/v1/partner/security").then(setData).catch((reason) => setError(reason instanceof ApiClientError ? reason.message : "Could not load security status.")); }, []);

  async function revoke() {
    if (!window.confirm("Sign out this account on every device? You will need to log in again.")) return;
    setBusy(true); setError(null);
    try { await api.post("/api/v1/partner/security/revoke-sessions", {}); await signOut(); router.push("/login"); }
    catch (reason) { setError(reason instanceof ApiClientError ? reason.message : "Could not revoke sessions."); setBusy(false); }
  }

  return (
    <PartnerShell title="Security">
      {error ? <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">{error}</div> : null}
      <div className="grid grid-cols-2 gap-3.5">
        <PtnCard><div className="flex items-start justify-between"><div><PtnLabel>Account identity</PtnLabel><div className="mt-2 text-sm font-semibold text-ptn-ink">{data?.email ?? "—"}</div><div className="mt-1 text-xs2 text-ptn-muted">Last login: {data?.lastLoginAt ? new Date(data.lastLoginAt).toLocaleString() : "not recorded"}</div></div><PtnPill tone={data?.emailVerified ? "ok" : "warn"}>{data?.emailVerified ? "Verified" : "Unverified"}</PtnPill></div></PtnCard>
        <PtnCard><div className="flex items-start justify-between"><div><PtnLabel>Two-factor authentication</PtnLabel><div className="mt-2 text-sm font-semibold text-ptn-ink">Not available in this deployment</div><div className="mt-1 text-xs2 leading-relaxed text-ptn-muted">No 2FA enrollment backend is configured, so the portal does not show a fake enabled toggle.</div></div><PtnPill tone="warn">Unavailable</PtnPill></div></PtnCard>
      </div>
      <PtnCard className="mt-3.5"><div className="flex items-center justify-between gap-4"><div><PtnLabel>Active sessions</PtnLabel><div className="mt-1 font-newsreader text-[26px] font-medium text-ptn-ink">{data?.activeSessions ?? "—"}</div><div className="text-xs2 text-ptn-muted">Valid refresh sessions for this account. Revoking them signs you out everywhere.</div></div><button type="button" disabled={busy || data === null} onClick={() => void revoke()} className="rounded-control border border-gmb-danger/40 px-4 py-2 text-sm2 font-semibold text-ptn-danger hover:bg-gmb-danger/10 disabled:opacity-50">{busy ? "Revoking…" : "Revoke all sessions"}</button></div></PtnCard>
    </PartnerShell>
  );
}
