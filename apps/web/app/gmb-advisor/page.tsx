"use client";

// AdGrowly — AI Ranking Advisor (planning PDF §2). Analyze a location's profile
// gaps into a health score + grade + prioritized weekly task list. Backed by
// module 12: /api/v1/gmb/advisor.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Task {
  priority: "high" | "medium" | "low";
  area: string;
  task: string;
}

interface ScoreArea {
  area: string;
  points: number;
  weight: number;
}

interface FocusArea {
  area: string;
  points: number;
  weight: number;
  gap: number;
  gapPercent: number;
}

interface Advice {
  id: string;
  locationId: string | null;
  score: number;
  grade: string;
  breakdown: ScoreArea[];
  focusAreas?: FocusArea[];
  summary?: string | null;
  tasks: Task[];
  createdAt: string;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

export default function GmbAdvisorPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<Advice[]>([]);
  const [locationId, setLocationId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      const q = locationId.trim() ? `?locationId=${encodeURIComponent(locationId.trim())}` : "";
      setItems(await api.get<Advice[]>(`/api/v1/gmb/advisor${q}`));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load advisor reports.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!locationId.trim()) {
      setErr("Enter a Location ID to analyze.");
      return;
    }
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/advisor", { locationId: locationId.trim() });
      setNotice("Advisor report generated.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to generate advice.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this report?")) return;
    try {
      await api.delete(`/api/v1/gmb/advisor/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  const scoreColor = (s: number) => (s >= 70 ? "text-emerald-600" : s >= 40 ? "text-amber-600" : "text-red-600");

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Ranking advisor</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Analyze a location&apos;s profile gaps into a 0–100 health score, a grade, and a prioritized weekly local-SEO task list.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <form onSubmit={generate} className="mb-6 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex-1 text-sm font-medium text-slate-700">
          Location ID
          <input value={locationId} onChange={(e) => setLocationId(e.target.value)} onBlur={() => void refresh()} placeholder="loc_…" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Analyze</button>
      </form>

      <div className="space-y-4">
        {items.length === 0 && <p className="text-sm text-slate-500">No advisor reports yet.</p>}
        {items.map((a) => (
          <div key={a.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className={`text-3xl font-bold ${scoreColor(a.score)}`}>{a.score}</p>
                  <p className="text-xs text-slate-500">grade {a.grade}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {a.breakdown.map((b) => (
                    <span key={b.area} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{b.area} {b.points}/{b.weight}</span>
                  ))}
                </div>
              </div>
              <button onClick={() => void remove(a.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
            </div>
            {a.summary && (
              <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{a.summary}</p>
            )}
            {a.focusAreas && a.focusAreas.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                <span className="font-medium text-slate-700">Focus first:</span>{" "}
                {a.focusAreas.slice(0, 3).map((f) => `${f.area} (+${f.gap} pts)`).join(" · ")}
              </p>
            )}
            {a.tasks.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {a.tasks.map((t, i) => (
                  <li key={i} className="text-sm text-slate-600">
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</span>
                    {t.task}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-emerald-600">No action items — this profile is in great shape.</p>
            )}
            <p className="mt-2 text-xs text-slate-400">{new Date(a.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
