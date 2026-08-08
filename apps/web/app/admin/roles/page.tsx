"use client";

import { useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface RoleData {
  permissions: string[];
  roles: Array<{ role: string; users: number; permissions: string[] }>;
}
const pretty = (value: string) => value.replaceAll("_", " ").replaceAll(":", " · ").toLowerCase();

export default function AdminRolesPage() {
  const [data, setData] = useState<RoleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.get<RoleData>("/api/v1/admin/roles").then(setData).catch((reason) => setError(reason instanceof ApiClientError ? reason.message : "Could not load roles."));
  }, []);

  return (
    <AdminShell title="Roles & access">
      {error ? <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">{error}</div> : null}
      <div className="mb-3.5 text-[13px] text-adm-muted">Role-based access control enforced by the API for every protected request.</div>
      <AdmCard className="overflow-x-auto p-0">
        {data === null ? <div className="py-10 text-center font-geist-mono text-xs text-adm-subtle">loading…</div> : (
          <table className="w-full border-collapse text-left">
            <thead><tr className="border-b border-adm-line bg-adm-panel-hover">
              <th className="px-5 py-4 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-adm-subtle">Permission</th>
              {data.roles.map((role) => <th key={role.role} className="px-4 py-4 text-center"><AdmPill tone={role.role === "SUPER_ADMIN" ? "brand" : "neutral"}>{pretty(role.role)}</AdmPill><div className="mt-1 font-geist-mono text-micro font-normal text-adm-subtle">{role.users} staff</div></th>)}
            </tr></thead>
            <tbody>{data.permissions.map((permission) => (
              <tr key={permission} className="border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover">
                <td className="px-5 py-3 text-sm2 capitalize text-adm-ink">{pretty(permission)}</td>
                {data.roles.map((role) => <td key={role.role} className="px-4 py-3 text-center"><span className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border text-xs font-bold ${role.permissions.includes(permission) ? "border-gmb-brand/40 bg-gmb-brand/20 text-adm-accent" : "border-adm-line bg-adm-bg text-adm-subtle"}`}>{role.permissions.includes(permission) ? "✓" : "—"}</span></td>)}
              </tr>
            ))}</tbody>
          </table>
        )}
      </AdmCard>
      <div className="mt-3 text-xs2 text-adm-subtle">Roles are code-defined security boundaries. Change them through reviewed backend policy, not a cosmetic client toggle.</div>
    </AdminShell>
  );
}
