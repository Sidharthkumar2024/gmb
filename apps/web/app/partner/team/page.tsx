"use client";

// Team — the agency's own staff, separate from customer-tenant users. Invite
// creates the account and emails a set-password link; the same link is shown
// here once, so the invite works even before platform email is configured.
// Remove deactivates and signs the person out; it never deletes history.

import { useCallback, useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";
import { useAuth } from "../../../src/hooks/useAuth";

type StaffRole = "WHITE_LABEL_ADMIN" | "AGENT";

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: StaffRole | string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface InviteResult {
  member: Member;
  inviteUrl: string;
  emailSent: boolean;
}

const ROLE_LABEL: Record<StaffRole, string> = {
  WHITE_LABEL_ADMIN: "Admin",
  AGENT: "Agent",
};

const inputCls =
  "w-full rounded-control border border-ptn-line bg-ptn-bg px-3 py-2 text-sm2 text-ptn-ink outline-none placeholder:text-ptn-subtle focus:border-ptn-accent";

export default function PartnerTeamPage() {
  const { user } = useAuth();
  const [team, setTeam] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("AGENT");
  const [lastInvite, setLastInvite] = useState<InviteResult | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTeam((await api.get<Member[]>("/api/v1/partner/team")) ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load your team.");
      setTeam([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy("invite");
    setError(null);
    setLastInvite(null);
    try {
      const result = await api.post<InviteResult>("/api/v1/partner/team/invite", {
        email: email.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        role,
      });
      setLastInvite(result);
      setEmail("");
      setName("");
      setRole("AGENT");
      setInviting(false);
      await load();
    } catch (e2) {
      setError(e2 instanceof ApiClientError ? e2.message : "Could not send the invite.");
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(m: Member, next: StaffRole) {
    if (m.role === next) return;
    setBusy(m.id);
    setError(null);
    try {
      await api.patch(`/api/v1/partner/team/${m.id}/role`, { role: next });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not change the role.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(m: Member) {
    if (!window.confirm(`Remove ${m.email}? They are signed out and can no longer log in.`)) return;
    setBusy(m.id);
    setError(null);
    try {
      await api.delete(`/api/v1/partner/team/${m.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not remove the team member.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <PartnerShell title="Team">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}

      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-sm2 text-ptn-muted">
          Your agency&rsquo;s own staff — separate from customer workspace users.
        </span>
        <button
          type="button"
          onClick={() => setInviting((v) => !v)}
          className="rounded-control bg-ptn-accent px-4 py-2 text-sm2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover"
        >
          {inviting ? "Cancel" : "+ Invite staff"}
        </button>
      </div>

      {lastInvite && (
        <div className="mb-3.5 rounded-card border border-ptn-accent/30 bg-ptn-accent/10 px-4 py-3">
          <div className="text-sm2 font-semibold text-ptn-accent">
            {lastInvite.member.email} invited
            {lastInvite.emailSent ? " — a set-password email is on its way." : " — email is off, share this link with them:"}
          </div>
          {!lastInvite.emailSent && (
            <input
              readOnly
              value={lastInvite.inviteUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 w-full rounded-control border border-ptn-line bg-ptn-bg px-3 py-2 font-geist-mono text-xs2 text-ptn-ink outline-none"
            />
          )}
        </div>
      )}

      {inviting && (
        <PtnCard className="mb-3.5">
          <form onSubmit={submitInvite} className="grid grid-cols-[1.4fr_1fr_150px_auto] items-end gap-2.5">
            <label className="flex flex-col gap-1">
              <PtnLabel>Email</PtnLabel>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="teammate@agency.com" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <PtnLabel>Name (optional)</PtnLabel>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <PtnLabel>Role</PtnLabel>
              <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className={inputCls}>
                <option value="AGENT">Agent</option>
                <option value="WHITE_LABEL_ADMIN">Admin</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={busy === "invite" || !email.trim()}
              className="rounded-control bg-ptn-accent px-4 py-2 text-sm2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover disabled:opacity-50"
            >
              {busy === "invite" ? "Inviting…" : "Invite"}
            </button>
          </form>
        </PtnCard>
      )}

      {team === null ? (
        <PtnCard>
          <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
        </PtnCard>
      ) : (
        <PtnCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ptn-line">
                {["Staff", "Role", "Last login", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-ptn-subtle">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.map((m) => {
                const isSelf = user?.id === m.id;
                return (
                  <tr key={m.id} className="border-b border-ptn-line/60 last:border-0 hover:bg-ptn-panel-hover">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-ptn-ink">{m.name || m.email}</span>
                        {isSelf && <PtnPill tone="ok">you</PtnPill>}
                        {!m.isActive && <PtnPill tone="danger">Removed</PtnPill>}
                      </div>
                      <div className="font-geist-mono text-micro text-ptn-subtle">{m.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {isSelf || !m.isActive ? (
                        <PtnPill tone="neutral">{ROLE_LABEL[m.role as StaffRole] ?? m.role}</PtnPill>
                      ) : (
                        <div className="flex gap-1.5">
                          {(["WHITE_LABEL_ADMIN", "AGENT"] as StaffRole[]).map((r) => (
                            <button
                              key={r}
                              type="button"
                              disabled={busy === m.id}
                              onClick={() => void changeRole(m, r)}
                              className={`rounded-full border px-3 py-1 text-[10.5px] font-semibold transition disabled:opacity-50 ${
                                m.role === r
                                  ? "border-ptn-accent bg-ptn-accent/15 text-ptn-accent"
                                  : "border-ptn-line text-ptn-muted hover:bg-ptn-panel-hover"
                              }`}
                            >
                              {ROLE_LABEL[r]}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-geist-mono text-micro text-ptn-subtle">
                      {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : "never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isSelf && m.isActive && (
                        <button
                          type="button"
                          disabled={busy === m.id}
                          onClick={() => void remove(m)}
                          className="rounded-control border border-ptn-line px-3 py-1.5 text-xs2 font-medium text-ptn-danger hover:bg-gmb-danger/10 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PtnCard>
      )}
    </PartnerShell>
  );
}
