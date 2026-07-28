"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../../src/lib/api";

// Partner view of a single customer — balance, plan, users, and the payments
// that customer made (to the partner's gateway). Scoped server-side to the
// partner's own children; a foreign id 404s.

interface Payment {
  id: string;
  provider: string;
  credits: number;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: string;
}
interface Detail {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  planName: string | null;
  creditBalance: number;
  users: number;
  locations: number;
  createdAt: string;
  payments: Payment[];
  collectedByCurrency: Record<string, number>;
}

const STATUS_TONE = { ACTIVE: "ok", SUSPENDED: "warn", DELETED: "danger" } as const;

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export default function PartnerCustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    void api
      .get<Detail>(`/api/v1/partner/customers/${id}`)
      .then(setD)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Could not load customer."))
      .finally(() => setLoading(false));
  }, [id]);

  const collected = d ? Object.entries(d.collectedByCurrency) : [];

  return (
    <PartnerShell title="Customer">
      <div className="mb-3.5">
        <Link
          href="/partner"
          className="rounded-control border border-ptn-line px-3 py-1.5 text-xs2 font-medium text-ptn-muted no-underline hover:bg-ptn-panel-hover hover:no-underline"
        >
          ← All customers
        </Link>
      </div>

      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}

      {loading ? (
        <PtnCard>
          <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
        </PtnCard>
      ) : d ? (
        <>
          <div className="mb-3.5 flex items-center gap-3">
            <div>
              <div className="text-lg font-bold tracking-[-0.01em] text-ptn-ink">{d.name}</div>
              <div className="font-geist-mono text-micro text-ptn-subtle">{d.slug}</div>
            </div>
            <PtnPill tone={STATUS_TONE[d.status]}>{d.status}</PtnPill>
          </div>

          <div className="mb-3.5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            {(
              [
                ["Credit balance", d.creditBalance.toLocaleString()],
                ["Plan", d.planName ?? "No plan"],
                ["Users", d.users.toLocaleString()],
                ["Locations", d.locations.toLocaleString()],
              ] as const
            ).map(([label, value]) => (
              <PtnCard key={label}>
                <PtnLabel>{label}</PtnLabel>
                <div className="mt-1.5 text-[20px] font-bold tracking-[-0.02em]">{value}</div>
              </PtnCard>
            ))}
          </div>

          <div className="mb-2 flex items-center gap-2">
            <PtnLabel>Payments</PtnLabel>
            <span className="ml-auto text-xs2 text-ptn-muted">
              Collected: {collected.length === 0 ? "—" : collected.map(([c, m]) => money(m, c)).join(" · ")}
            </span>
          </div>

          {d.payments.length === 0 ? (
            <PtnCard>
              <div className="py-6 text-center text-sm2 text-ptn-muted">
                No payments from this customer yet.
              </div>
            </PtnCard>
          ) : (
            <PtnCard className="overflow-x-auto p-0">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-ptn-line">
                    {["When", "Gateway", "Credits", "Amount", "Status"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-ptn-subtle"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.payments.map((p) => (
                    <tr key={p.id} className="border-b border-ptn-line/60 last:border-0 hover:bg-ptn-panel-hover">
                      <td className="whitespace-nowrap px-4 py-3 font-geist-mono text-micro text-ptn-subtle">
                        {new Date(p.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs2 text-ptn-muted">{p.provider}</td>
                      <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-accent">
                        +{p.credits.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-muted">
                        {money(p.amountMinor, p.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <PtnPill tone={p.status === "CAPTURED" ? "ok" : "neutral"}>{p.status}</PtnPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PtnCard>
          )}
        </>
      ) : null}
    </PartnerShell>
  );
}
