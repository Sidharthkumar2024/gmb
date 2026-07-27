"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../src/lib/api";

// Partner dashboard — the reseller's customers, from real records, plus the
// onboarding flow to add a new customer workspace. Commission/margin live on the
// statement (see /partner/invoices); this page links there rather than faking
// numbers here.

interface Customer {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  planName: string | null;
  locations: number;
  users: number;
  createdAt: string;
}
interface Overview {
  totals: { customers: number; active: number; locations: number };
  customers: Customer[];
}
interface ResalePlan {
  id: string;
  name: string;
}
interface CreateResult {
  customer: Customer;
  inviteUrl: string;
  emailSent: boolean;
}

const STATUS_TONE = { ACTIVE: "ok", SUSPENDED: "warn", DELETED: "danger" } as const;
const blankForm = { businessName: "", adminEmail: "", adminName: "", partnerPlanId: "" };

export default function PartnerDashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [plans, setPlans] = useState<ResalePlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreateResult | null>(null);

  const load = () =>
    api
      .get<Overview>("/api/v1/partner/overview")
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Could not load your customers."));

  useEffect(() => {
    void load();
    void api.get<ResalePlan[]>("/api/v1/partner/plans").then((r) => setPlans(r ?? [])).catch(() => setPlans([]));
  }, []);

  const submit = async () => {
    if (!form.businessName.trim() || !form.adminEmail.trim()) {
      setError("A business name and an admin email are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        businessName: form.businessName.trim(),
        adminEmail: form.adminEmail.trim(),
        ...(form.adminName.trim() ? { adminName: form.adminName.trim() } : {}),
        ...(form.partnerPlanId ? { partnerPlanId: form.partnerPlanId } : {}),
      };
      const result = await api.post<CreateResult>("/api/v1/partner/customers", body);
      setCreated(result);
      setForm(blankForm);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not create the customer.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-control border border-ptn-line bg-ptn-bg px-3 py-2 text-sm2 text-ptn-ink outline-none focus:border-ptn-accent";

  return (
    <PartnerShell title="Dashboard">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}

      {created && (
        <div className="mb-3.5 rounded-card border border-ptn-accent/30 bg-ptn-accent/10 px-4 py-3">
          <div className="text-sm2 font-semibold text-ptn-ink">{created.customer.name} created</div>
          <div className="mt-1 text-xs2 text-ptn-muted">
            {created.emailSent
              ? "An invite email was sent to the admin to set their password."
              : "Email isn't configured — share this invite link with the admin so they can set a password:"}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={created.inviteUrl} className={`${inputCls} font-geist-mono text-micro`} />
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="rounded-control border border-ptn-line px-3 py-2 text-xs2 font-medium text-ptn-muted hover:bg-ptn-panel-hover"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3.5">
        {(
          [
            ["Customers", data?.totals.customers, "workspaces you manage"],
            ["Active", data?.totals.active, "not suspended"],
            ["Locations", data?.totals.locations, "across all customers"],
          ] as const
        ).map(([label, value, caption]) => (
          <PtnCard key={label}>
            <PtnLabel>{label}</PtnLabel>
            <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
              {typeof value === "number" ? value.toLocaleString() : "—"}
            </div>
            <div className="mt-1 text-xs2 text-ptn-muted">{caption}</div>
          </PtnCard>
        ))}
      </div>

      <div className="mt-3.5 rounded-card border border-ptn-line bg-ptn-panel-hover px-4 py-3">
        <div className="flex items-center gap-2">
          <PtnLabel>Billing & commission</PtnLabel>
          <span className="text-xs2 text-ptn-muted">
            Your month-to-date margin and finalised invoices are on your{" "}
            <Link href="/partner/invoices" className="text-ptn-accent no-underline hover:underline">
              statement
            </Link>
            .
          </span>
        </div>
      </div>

      <div className="mt-3.5">
        <div className="mb-2 flex items-center gap-2">
          <PtnLabel>Customers</PtnLabel>
          <button
            type="button"
            onClick={() => {
              setShowForm((s) => !s);
              setCreated(null);
            }}
            className="ml-auto rounded-control bg-ptn-accent px-3.5 py-1.5 text-xs2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover"
          >
            {showForm ? "Cancel" : "+ Add customer"}
          </button>
        </div>

        {showForm && (
          <PtnCard className="mb-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs2 text-ptn-muted">Business name</label>
                <input
                  className={inputCls}
                  placeholder="e.g. Bloor Physio"
                  value={form.businessName}
                  onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs2 text-ptn-muted">Admin email</label>
                <input
                  className={inputCls}
                  placeholder="owner@business.com"
                  value={form.adminEmail}
                  onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs2 text-ptn-muted">Admin name (optional)</label>
                <input
                  className={inputCls}
                  placeholder="Full name"
                  value={form.adminName}
                  onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs2 text-ptn-muted">Plan (optional)</label>
                <select
                  className={inputCls}
                  value={form.partnerPlanId}
                  onChange={(e) => setForm({ ...form, partnerPlanId: e.target.value })}
                >
                  <option value="">No plan</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="rounded-control bg-ptn-accent px-4 py-2 text-sm2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create customer"}
              </button>
              <span className="ml-3 text-xs2 text-ptn-subtle">
                The admin sets their own password via an invite link — no password is emailed.
              </span>
            </div>
          </PtnCard>
        )}

        {data === null ? (
          <PtnCard>
            <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
          </PtnCard>
        ) : data.customers.length === 0 ? (
          <PtnCard>
            <div className="py-8 text-center text-sm2 text-ptn-muted">
              No customers yet. Use “Add customer” to onboard your first workspace.
            </div>
          </PtnCard>
        ) : (
          <PtnCard className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-ptn-line">
                  {["Business", "Plan", "Locations", "Users", "Status", "Since"].map((h) => (
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
                {data.customers.map((c) => (
                  <tr key={c.id} className="border-b border-ptn-line/60 last:border-0 hover:bg-ptn-panel-hover">
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-semibold text-ptn-ink">{c.name}</div>
                      <div className="font-geist-mono text-micro text-ptn-subtle">{c.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-xs2 text-ptn-muted">{c.planName ?? "No plan"}</td>
                    <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-muted">{c.locations}</td>
                    <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-muted">{c.users}</td>
                    <td className="px-4 py-3">
                      <PtnPill tone={STATUS_TONE[c.status]}>{c.status}</PtnPill>
                    </td>
                    <td className="px-4 py-3 font-geist-mono text-micro text-ptn-subtle">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PtnCard>
        )}
      </div>
    </PartnerShell>
  );
}
