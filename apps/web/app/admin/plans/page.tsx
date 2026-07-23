"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Plans — the subscription/entitlement catalog.
//
// A plan defines what a workspace is entitled to (limits, credit allotment),
// not what it's charged: this build has no payment gateway, so price is
// display-only. Limits ARE enforced (e.g. locations); blank = unlimited.

interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: "MONTH" | "YEAR";
  monthlyCredits: number;
  maxLocations: number | null;
  maxKeywords: number | null;
  maxUsers: number | null;
  features: string[];
  status: "ACTIVE" | "ARCHIVED";
  isDefault: boolean;
  sortOrder: number;
  tenantCount: number;
}

interface FormState {
  name: string;
  description: string;
  price: string; // dollars, converted to cents on submit
  currency: string;
  interval: "MONTH" | "YEAR";
  monthlyCredits: string;
  maxLocations: string;
  maxKeywords: string;
  maxUsers: string;
  features: string; // one per line
  isDefault: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  price: "0",
  currency: "USD",
  interval: "MONTH",
  monthlyCredits: "0",
  maxLocations: "",
  maxKeywords: "",
  maxUsers: "",
  features: "",
  isDefault: false,
};

const inputCls =
  "rounded-control border border-adm-line bg-adm-bg px-3 py-2 text-sm2 text-adm-ink outline-none placeholder:text-adm-subtle focus:border-gmb-brand";

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function limitLabel(n: number | null): string {
  return n == null ? "Unlimited" : n.toLocaleString();
}

// "" → null (unlimited); a number string → that number.
function parseLimit(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPlans((await api.get<Plan[]>("/api/v1/admin/plans")) ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load plans.");
      setPlans([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setForm(EMPTY_FORM);
    setEditingId("new");
  }

  function openEdit(p: Plan) {
    setForm({
      name: p.name,
      description: p.description ?? "",
      price: (p.priceCents / 100).toString(),
      currency: p.currency,
      interval: p.interval,
      monthlyCredits: p.monthlyCredits.toString(),
      maxLocations: p.maxLocations?.toString() ?? "",
      maxKeywords: p.maxKeywords?.toString() ?? "",
      maxUsers: p.maxUsers?.toString() ?? "",
      features: p.features.join("\n"),
      isDefault: p.isDefault,
    });
    setEditingId(p.id);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const priceDollars = Number(form.price) || 0;
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      priceCents: Math.max(0, Math.round(priceDollars * 100)),
      currency: form.currency.trim().toUpperCase() || "USD",
      interval: form.interval,
      monthlyCredits: Math.max(0, Math.floor(Number(form.monthlyCredits) || 0)),
      maxLocations: parseLimit(form.maxLocations),
      maxKeywords: parseLimit(form.maxKeywords),
      maxUsers: parseLimit(form.maxUsers),
      features: form.features
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean),
      isDefault: form.isDefault,
    };
    try {
      if (editingId === "new") {
        await api.post("/api/v1/admin/plans", body);
      } else if (editingId) {
        await api.patch(`/api/v1/admin/plans/${editingId}`, body);
      }
      setEditingId(null);
      await load();
    } catch (e2) {
      setError(e2 instanceof ApiClientError ? e2.message : "Could not save the plan.");
    } finally {
      setSaving(false);
    }
  }

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "The change did not apply.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Plans">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-xs2 text-adm-muted">
          Plans define entitlements, not charges — price is display-only until a payment gateway is
          added. Limits are enforced; blank means unlimited.
        </span>
        <button
          type="button"
          onClick={openNew}
          className="rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white hover:bg-gmb-brand-hover"
        >
          New plan
        </button>
      </div>

      {plans === null ? (
        <AdmCard>
          <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        </AdmCard>
      ) : plans.length === 0 ? (
        <AdmCard>
          <div className="py-8 text-center text-sm2 text-adm-muted">
            No plans yet. Create one to start defining workspace entitlements.
          </div>
        </AdmCard>
      ) : (
        <AdmCard className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-adm-line">
                {["Plan", "Price", "Credits / mo", "Limits", "Workspaces", "Status", ""].map((h) => (
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
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-adm-ink">{p.name}</span>
                      {p.isDefault && <AdmPill tone="brand">default</AdmPill>}
                    </div>
                    <div className="font-geist-mono text-micro text-adm-subtle">{p.slug}</div>
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">
                    {p.priceCents === 0 ? "Free" : `${money(p.priceCents, p.currency)}/${p.interval === "MONTH" ? "mo" : "yr"}`}
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">
                    {p.monthlyCredits.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs2 text-adm-muted">
                    <div>Loc: {limitLabel(p.maxLocations)}</div>
                    <div className="text-adm-subtle">
                      Kw: {limitLabel(p.maxKeywords)} · Users: {limitLabel(p.maxUsers)}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">{p.tenantCount}</td>
                  <td className="px-4 py-3">
                    <AdmPill tone={p.status === "ACTIVE" ? "ok" : "neutral"}>{p.status}</AdmPill>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="rounded-control border border-adm-line px-2.5 py-1.5 text-xs2 font-medium text-adm-muted hover:bg-adm-panel-hover"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy === p.id}
                        onClick={() =>
                          void run(p.id, () =>
                            api.patch(`/api/v1/admin/plans/${p.id}`, {
                              status: p.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
                            }),
                          )
                        }
                        className="rounded-control border border-adm-line px-2.5 py-1.5 text-xs2 font-medium text-adm-muted hover:bg-adm-panel-hover disabled:opacity-50"
                      >
                        {p.status === "ACTIVE" ? "Archive" : "Restore"}
                      </button>
                      <button
                        type="button"
                        disabled={busy === p.id}
                        onClick={() => {
                          if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
                          void run(p.id, () => api.delete(`/api/v1/admin/plans/${p.id}`));
                        }}
                        className="rounded-control border border-adm-line px-2.5 py-1.5 text-xs2 font-medium text-[#ff8f85] hover:bg-gmb-danger/10 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdmCard>
      )}

      {editingId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-6">
          <div className="mt-8 w-full max-w-[560px] rounded-card border border-adm-line bg-adm-panel p-5">
            <div className="mb-3 flex items-center justify-between">
              <AdmLabel>{editingId === "new" ? "New plan" : "Edit plan"}</AdmLabel>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="text-xs2 text-adm-subtle hover:text-adm-ink"
              >
                Close
              </button>
            </div>
            <form onSubmit={submit} className="grid grid-cols-2 gap-3">
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-adm-subtle">Name</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputCls} />
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-adm-subtle">Description (optional)</span>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-adm-subtle">Price</span>
                <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-adm-subtle">Currency</span>
                <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} maxLength={3} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-adm-subtle">Interval</span>
                <select value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value as "MONTH" | "YEAR" })} className={inputCls}>
                  <option value="MONTH">Monthly</option>
                  <option value="YEAR">Yearly</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-adm-subtle">Credits / month</span>
                <input value={form.monthlyCredits} onChange={(e) => setForm({ ...form, monthlyCredits: e.target.value })} inputMode="numeric" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-adm-subtle">Max locations</span>
                <input value={form.maxLocations} onChange={(e) => setForm({ ...form, maxLocations: e.target.value })} placeholder="unlimited" inputMode="numeric" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-adm-subtle">Max keywords</span>
                <input value={form.maxKeywords} onChange={(e) => setForm({ ...form, maxKeywords: e.target.value })} placeholder="unlimited" inputMode="numeric" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-adm-subtle">Max users</span>
                <input value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: e.target.value })} placeholder="unlimited" inputMode="numeric" className={inputCls} />
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-micro uppercase tracking-wide text-adm-subtle">Features (one per line)</span>
                <textarea value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} rows={3} className={inputCls} />
              </label>
              <label className="col-span-2 flex items-center gap-2">
                <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
                <span className="text-xs2 text-adm-muted">Default plan (only one can be default)</span>
              </label>
              <div className="col-span-2 mt-1 flex justify-end gap-2">
                <button type="button" onClick={() => setEditingId(null)} className="rounded-control border border-adm-line px-4 py-2 text-sm2 font-medium text-adm-muted hover:bg-adm-panel-hover">
                  Cancel
                </button>
                <button type="submit" disabled={saving || !form.name.trim()} className="rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white hover:bg-gmb-brand-hover disabled:opacity-50">
                  {saving ? "Saving…" : editingId === "new" ? "Create plan" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
