"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel } from "../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../src/lib/api";

// Admin overview — platform-wide counts and 30-day AI spend.
// Every number is a live aggregate; nothing here is cached or mocked.

interface Overview {
  tenants: { total: number; active: number };
  users: number;
  locations: number;
  reviews: number;
  posts: number;
  ai30d: { calls: number; costInCents: number };
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<Overview>("/api/v1/admin/overview")
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiClientError ? e.message : "Could not load the overview."),
      );
  }, []);

  return (
    <AdminShell title="Overview">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-4 gap-3.5">
        {(
          [
            ["Workspaces", data?.tenants.total, data ? `${data.tenants.active} active` : ""],
            ["Users", data?.users, ""],
            ["Locations", data?.locations, ""],
            ["Reviews", data?.reviews, ""],
          ] as const
        ).map(([label, value, caption]) => (
          <AdmCard key={label}>
            <AdmLabel>{label}</AdmLabel>
            <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
              {typeof value === "number" ? value.toLocaleString() : "—"}
            </div>
            {caption && <div className="mt-1 text-xs2 text-adm-muted">{caption}</div>}
          </AdmCard>
        ))}
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-3.5">
        <AdmCard>
          <AdmLabel>AI usage · last 30 days</AdmLabel>
          <div className="mt-1.5 flex items-baseline gap-4">
            <div>
              <div className="text-[28px] font-bold tracking-[-0.02em]">
                {data ? data.ai30d.calls.toLocaleString() : "—"}
              </div>
              <div className="text-micro uppercase tracking-wide text-adm-subtle">calls</div>
            </div>
            <div>
              <div className="text-[28px] font-bold tracking-[-0.02em] text-adm-accent">
                {data ? `$${(data.ai30d.costInCents / 100).toFixed(2)}` : "—"}
              </div>
              <div className="text-micro uppercase tracking-wide text-adm-subtle">provider cost</div>
            </div>
          </div>
        </AdmCard>

        <AdmCard>
          <AdmLabel>Content</AdmLabel>
          <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
            {data ? data.posts.toLocaleString() : "—"}
          </div>
          <div className="mt-1 text-xs2 text-adm-muted">posts across all workspaces</div>
        </AdmCard>
      </div>

      <div className="mt-3.5 flex gap-2">
        {(
          [
            ["/admin/accounts", "Manage accounts"],
            ["/admin/users", "Manage users"],
            ["/admin/audit", "View audit log"],
          ] as const
        ).map(([href, label]) => (
          <Link key={href} href={href} className="no-underline hover:no-underline">
            <span className="inline-block rounded-control border border-adm-line bg-adm-panel px-4 py-2 text-sm2 font-semibold text-adm-ink hover:bg-adm-panel-hover">
              {label}
            </span>
          </Link>
        ))}
      </div>
    </AdminShell>
  );
}
