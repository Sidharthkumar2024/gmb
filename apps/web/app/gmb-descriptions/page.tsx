"use client";

// AdGrowly — Description Optimizer (planning PDF §2). Optimize a business /
// service / product description against target keywords + a length limit, then
// save as a generate-then-approve draft. Backed by module 11:
// /api/v1/gmb/descriptions (+ /optimize).

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const TARGETS = ["BUSINESS", "SERVICE", "PRODUCT"] as const;
const TONES = ["professional", "friendly"] as const;

interface Analysis {
  length: number;
  wordCount: number;
  withinLimit: boolean;
  missingKeywords: string[];
  issues: string[];
}

interface OptimizeResult {
  optimized: string;
  analysis: Analysis;
  changes: string[];
  score?: { score: number; keywordCoverage: number; lengthOk: boolean; issues: number };
  source?: "ai" | "template";
}

interface Description {
  id: string;
  target: string;
  label: string | null;
  original: string;
  optimized: string | null;
  keywords: string[];
  status: "DRAFT" | "APPROVED" | "REJECTED";
  analysis: Analysis | null;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function GmbDescriptionsPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [target, setTarget] = useState<string>("BUSINESS");
  const [label, setLabel] = useState("");
  const [original, setOriginal] = useState("");
  const [keywords, setKeywords] = useState("");
  const [maxLength, setMaxLength] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [tone, setTone] = useState<string>("professional");
  const [locationId, setLocationId] = useState("");

  const [preview, setPreview] = useState<OptimizeResult | null>(null);
  const [drafts, setDrafts] = useState<Description[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function body() {
    return {
      text: original,
      original,
      target,
      label: label.trim() || undefined,
      keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
      maxLength: maxLength ? Number(maxLength) : undefined,
      businessName: businessName.trim() || undefined,
      tone,
      locationId: locationId.trim() || undefined,
    };
  }

  async function refresh() {
    try {
      setErr(null);
      const q = locationId.trim() ? `?locationId=${encodeURIComponent(locationId.trim())}` : "";
      setDrafts(await api.get<Description[]>(`/api/v1/gmb/descriptions${q}`));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load descriptions.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function runPreview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      setPreview(await api.post<OptimizeResult>("/api/v1/gmb/descriptions/optimize", body()));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to optimize.");
    }
  }

  async function saveDraft() {
    setErr(null);
    try {
      await api.post("/api/v1/gmb/descriptions", body());
      setNotice("Draft saved.");
      setPreview(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to save draft.");
    }
  }

  async function setStatus(id: string, status: "APPROVED" | "REJECTED") {
    try {
      await api.patch(`/api/v1/gmb/descriptions/${id}`, { status });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to update status.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this draft?")) return;
    try {
      await api.delete(`/api/v1/gmb/descriptions/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Description optimizer</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Improve a business, service or product description against target keywords and a length limit — preview, then save for approval.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-[380px,1fr]">
        <form onSubmit={runPreview} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Optimize</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              Target
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Tone
              <select value={tone} onChange={(e) => setTone(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Original description
            <textarea value={original} onChange={(e) => setOriginal(e.target.value)} required rows={4} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Target keywords (comma-separated)
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              Max length
              <input type="number" min={20} value={maxLength} onChange={(e) => setMaxLength(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Label
              <input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
          </div>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Business name
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Location ID (to save)
            <input value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Preview</button>
            <button type="button" onClick={() => void saveDraft()} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Save draft</button>
          </div>
        </form>

        <div className="space-y-4">
          {preview && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">Preview</h3>
                <span className="flex items-center gap-1.5">
                {preview.source && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${preview.source === "ai" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                    {preview.source === "ai" ? "AI" : "Starter"}
                  </span>
                )}
                {preview.score && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      preview.score.score >= 80
                        ? "bg-emerald-100 text-emerald-700"
                        : preview.score.score >= 50
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                    }`}
                    title={`${Math.round(preview.score.keywordCoverage * 100)}% keyword coverage · ${preview.score.lengthOk ? "length ok" : "length issue"} · ${preview.score.issues} issue(s)`}
                  >
                    Quality {preview.score.score}/100
                  </span>
                )}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap rounded-md bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">{preview.optimized}</p>
              <p className="mt-2 text-xs text-slate-500">
                {preview.analysis.length} chars · {preview.analysis.wordCount} words · {preview.analysis.withinLimit ? "within limit" : "over limit"}
                {preview.analysis.missingKeywords.length > 0 && ` · missing: ${preview.analysis.missingKeywords.join(", ")}`}
              </p>
              {preview.changes.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-slate-500">
                  {preview.changes.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              )}
            </div>
          )}

          <div>
            <h2 className="mb-2 text-base font-semibold text-slate-950">Saved drafts</h2>
            <div className="space-y-3">
              {drafts.length === 0 && <p className="text-sm text-slate-500">No drafts yet.</p>}
              {drafts.map((d) => (
                <div key={d.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">
                      {d.target}{d.label ? ` · ${d.label}` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[d.status]}`}>{d.status}</span>
                      <button onClick={() => void remove(d.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
                    </div>
                  </div>
                  {d.optimized && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{d.optimized}</p>}
                  {d.analysis && d.analysis.issues.length > 0 && (
                    <p className="mt-1 text-xs text-amber-700">{d.analysis.issues.join(" · ")}</p>
                  )}
                  {d.status === "DRAFT" && (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => void setStatus(d.id, "APPROVED")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Approve</button>
                      <button onClick={() => void setStatus(d.id, "REJECTED")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
