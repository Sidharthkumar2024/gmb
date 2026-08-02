"use client";

import { useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Partner resale plans. The partner resells a platform plan (wholesale) to its
// own customers at a retail price it sets; margin = retail − wholesale is
// computed server-side from the base plan's current price.

interface BasePlan {
  id: string;
  name: string;
  wholesaleCents: number;
  currency: string;
  monthlyCredits: number;
}
interface PartnerPlan {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  retailCents: number;
  currency: string;
  basePlan: BasePlan;
  marginCents: number;
  sortOrder: number;
  createdAt: string;
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

interface PlanForm {
  id: string;
  name: string;
  basePlanId: string;
  retailDisplay: string;
  status: "ACTIVE" | "ARCHIVED";
}
const blankForm: PlanForm = { id: "", name: "", basePlanId: "", retailDisplay: "", status: "ACTIVE" };

export default function PartnerPlansPage() {
  const [plans, setPlans] = useState<PartnerPlan[] | null>(null);
  const [bases, setBases] = useState<BasePlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<typeof blankForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [p, b] = await Promise.all([
        api.get<PartnerPlan[]>("/api/v1/partner/plans"),
        api.get<BasePlan[]>("/api/v1/partner/base-plans"),
      ]);
      setPlans(p ?? []);
      setBases(b ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load plans.");
      setPlans([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedBase = bases.find((b) => b.id === form.basePlanId);
  const retailCents = Math.round(parseFloat(form.retailDisplay || "0") * 100);
  const previewMargin =
    selectedBase && Number.isFinite(retailCents) ? retailCents - selectedBase.wholesaleCents : null;

  const resetForm = () => setForm(blankForm);

  const submit = async () => {
    if (!form.name.trim() || !form.basePlanId) {
      setError("Pick a base plan and give the plan a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        basePlanId: form.basePlanId,
        retailCents: Number.isFinite(retailCents) ? retailCents : 0,
        status: form.status,
      };
      if (form.id) {
        await api.patch(`/api/v1/partner/plans/${form.id}`, body);
      } else {
        await api.post("/api/v1/partner/plans", body);
      }
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the plan.");
    } finally {
      setSaving(false);
    }
  };

  const edit = (p: PartnerPlan) =>
    setForm({
      id: p.id,
      name: p.name,
      basePlanId: p.basePlan.id,
      retailDisplay: (p.retailCents / 100).toString(),
      status: p.status,
    });

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.delete(`/api/v1/partner/plans/${id}`);
      if (form.id === id) resetForm();
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not delete the plan.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleArchive = async (plan: PartnerPlan) => {
    setBusyId(plan.id);
    setError(null);
    try {
      await api.patch(`/api/v1/partner/plans/${plan.id}`, {
        name: plan.name,
        basePlanId: plan.basePlan.id,
        retailCents: plan.retailCents,
        status: plan.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
        sortOrder: plan.sortOrder,
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update plan status.");
    } finally { setBusyId(null); }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!plans) return;
    const target = index + direction;
    if (target < 0 || target >= plans.length) return;
    const ordered = [...plans];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setPlans(ordered);
    try {
      setPlans(await api.post<PartnerPlan[]>("/api/v1/partner/plans/reorder", { orderedIds: ordered.map((plan) => plan.id) }));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not reorder plans.");
      await load();
    }
  };

  const inputCls =
    "w-full rounded-control border border-ptn-line bg-ptn-bg px-3 py-2 text-sm2 text-ptn-ink outline-none focus:border-ptn-accent";

  return (
    <PartnerShell title="Resale plans">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_340px]">
        {/* List */}
        <div>
          {plans === null ? (
            <PtnCard>
              <div className="py-8 text-center font-geist-mono text-xs text-ptn-subtle">loading…</div>
            </PtnCard>
          ) : plans.length === 0 ? (
            <PtnCard>
              <div className="py-8 text-center text-sm2 text-ptn-muted">
                No resale plans yet. Create one to offer your customers a branded plan.
              </div>
            </PtnCard>
          ) : (
            <PtnCard className="overflow-x-auto p-0">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-ptn-line">
                    {["Plan", "Resells", "Wholesale", "Retail", "Margin", "Status", ""].map((h) => (
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
                  {plans.map((p, index) => (
                    <tr
                      key={p.id}
                      className="border-b border-ptn-line/60 last:border-0 hover:bg-ptn-panel-hover"
                    >
                      <td className="px-4 py-3 text-xs2 font-semibold text-ptn-ink">{p.name}</td>
                      <td className="px-4 py-3 text-xs2 text-ptn-muted">{p.basePlan.name}</td>
                      <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-muted">
                        {money(p.basePlan.wholesaleCents, p.currency)}
                      </td>
                      <td className="px-4 py-3 font-geist-mono text-xs2 text-ptn-ink">
                        {money(p.retailCents, p.currency)}
                      </td>
                      <td
                        className={`px-4 py-3 font-geist-mono text-xs2 font-semibold ${
                          p.marginCents > 0
                            ? "text-ptn-accent"
                            : p.marginCents < 0
                              ? "text-ptn-danger"
                              : "text-ptn-subtle"
                        }`}
                      >
                        {p.marginCents >= 0 ? "+" : "−"}
                        {money(Math.abs(p.marginCents), p.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <PtnPill tone={p.status === "ACTIVE" ? "ok" : "neutral"}>{p.status}</PtnPill>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => void move(index, -1)} className="mr-1 rounded-control border border-ptn-line px-2 py-1 text-xs2 disabled:opacity-30">↑</button>
                        <button type="button" aria-label="Move down" disabled={index === plans.length - 1} onClick={() => void move(index, 1)} className="mr-1.5 rounded-control border border-ptn-line px-2 py-1 text-xs2 disabled:opacity-30">↓</button>
                        <button
                          type="button"
                          onClick={() => edit(p)}
                          className="mr-1.5 rounded-control border border-ptn-line px-2.5 py-1 text-xs2 font-medium text-ptn-muted hover:bg-ptn-panel-hover"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleArchive(p)}
                          disabled={busyId === p.id}
                          className="mr-1.5 rounded-control border border-ptn-line px-2.5 py-1 text-xs2 font-medium text-ptn-muted hover:bg-ptn-panel-hover"
                        >
                          {p.status === "ACTIVE" ? "Archive" : "Restore"}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(p.id)}
                          disabled={busyId === p.id || p.status !== "ARCHIVED"}
                          className="rounded-control border border-ptn-line px-2.5 py-1 text-xs2 font-medium text-ptn-danger hover:bg-gmb-danger/10 disabled:opacity-50"
                        >
                          {busyId === p.id ? "…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PtnCard>
          )}
        </div>

        {/* Form */}
        <PtnCard>
          <PtnLabel>{form.id ? "Edit plan" : "New resale plan"}</PtnLabel>
          <div className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-xs2 text-ptn-muted">Plan name</label>
              <input
                className={inputCls}
                placeholder="e.g. Local Growth"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs2 text-ptn-muted">Resells (wholesale)</label>
              <select
                className={inputCls}
                value={form.basePlanId}
                onChange={(e) => setForm({ ...form, basePlanId: e.target.value })}
              >
                <option value="">Select a platform plan…</option>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {money(b.wholesaleCents, b.currency)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs2 text-ptn-muted">
                Retail price {selectedBase ? `(${selectedBase.currency})` : ""}
              </label>
              <input
                className={inputCls}
                inputMode="decimal"
                placeholder="0.00"
                value={form.retailDisplay}
                onChange={(e) => setForm({ ...form, retailDisplay: e.target.value })}
              />
            </div>
            {previewMargin !== null && selectedBase && (
              <div className="rounded-control border border-ptn-line bg-ptn-bg px-3 py-2 text-xs2">
                <span className="text-ptn-muted">Your margin: </span>
                <span
                  className={`font-geist-mono font-semibold ${
                    previewMargin >= 0 ? "text-ptn-accent" : "text-ptn-danger"
                  }`}
                >
                  {previewMargin >= 0 ? "+" : "−"}
                  {money(Math.abs(previewMargin), selectedBase.currency)}
                </span>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="rounded-control bg-ptn-accent px-4 py-2 text-sm2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover disabled:opacity-50"
              >
                {saving ? "Saving…" : form.id ? "Save changes" : "Create plan"}
              </button>
              {form.id && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-control border border-ptn-line px-4 py-2 text-sm2 font-medium text-ptn-muted hover:bg-ptn-panel-hover"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </PtnCard>
      </div>
    </PartnerShell>
  );
}
