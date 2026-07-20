"use client";

// AdGrowly — AI Image Generator (planning PDF §2). Build an image prompt and
// queue a generation request (generate-then-approve). Backed by module 15:
// /api/v1/gmb/images (+ /prompt preview).

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const SIZES = ["1024x1024", "1024x1792", "1792x1024"] as const;

interface ImageReq {
  id: string;
  subject: string;
  prompt: string;
  size: string;
  aspect: string;
  status: "PENDING" | "READY" | "FAILED" | "APPROVED" | "REJECTED";
  resultUrl: string | null;
  error?: string | null;
  hasCredential: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  READY: "bg-sky-50 text-sky-700 border-sky-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function GmbImagesPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<ImageReq[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [style, setStyle] = useState("");
  const [palette, setPalette] = useState("");
  const [size, setSize] = useState<string>("1024x1024");
  const [locationId, setLocationId] = useState("");

  async function refresh() {
    try {
      setErr(null);
      setItems(await api.get<ImageReq[]>("/api/v1/gmb/images"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load image requests.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  function buildBody() {
    return {
      subject: subject.trim(),
      businessName: businessName.trim() || undefined,
      style: style.trim() || undefined,
      palette: palette.trim() || undefined,
      size,
      locationId: locationId.trim() || undefined,
    };
  }

  async function preview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    try {
      const res = await api.post<{ prompt: string }>("/api/v1/gmb/images/prompt", buildBody());
      setPreviewPrompt(res.prompt);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to build prompt.");
    }
  }

  async function createRequest() {
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/images", buildBody());
      setNotice("Image request queued — generation starts automatically.");
      setPreviewPrompt(null);
      await refresh();
      // Auto-generation runs server-side; pick up READY/FAILED shortly after.
      window.setTimeout(() => void refresh(), 8000);
      window.setTimeout(() => void refresh(), 20000);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to queue request.");
    }
  }

  async function setStatus(id: string, status: "APPROVED" | "REJECTED") {
    try {
      await api.patch(`/api/v1/gmb/images/${id}`, { status });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to update status.");
    }
  }

  async function generate(id: string) {
    setErr(null);
    setBusyId(id);
    try {
      await api.post(`/api/v1/gmb/images/${id}/generate`, {});
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to generate the image.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this image request?")) return;
    try {
      await api.delete(`/api/v1/gmb/images/${id}`);
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
        <h1 className="text-2xl font-semibold text-slate-950">AI image generator</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Describe a post or creative image; we build the prompt and queue it with your configured image provider. Generated images are reviewed before use.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-[340px,1fr]">
        <form onSubmit={preview} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">New image</h2>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Subject
            <textarea value={subject} onChange={(e) => setSubject(e.target.value)} required rows={2} placeholder="a cozy latte on a wooden table" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Business name
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              Style
              <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="warm photographic" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Palette
              <input value={palette} onChange={(e) => setPalette(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              Size
              <select value={size} onChange={(e) => setSize(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Location ID
              <input value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Preview prompt</button>
            <button type="button" onClick={() => void createRequest()} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Queue image</button>
          </div>
          {previewPrompt && <p className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{previewPrompt}</p>}
        </form>

        <div className="space-y-3">
          {items.length === 0 && <p className="text-sm text-slate-500">No image requests yet.</p>}
          {items.map((it) => (
            <div key={it.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{it.subject}</span>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[it.status]}`}>{it.status}</span>
                  <button onClick={() => void remove(it.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-400">{it.size} · {it.aspect}{it.hasCredential ? " · provider set" : " · no provider"}</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{it.prompt}</pre>
              {it.error && (it.status === "FAILED" || it.status === "PENDING") && (
                <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{it.error}</p>
              )}
              {it.resultUrl && (
                <a href={it.resultUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.resultUrl} alt={it.subject} className="max-h-40 rounded-md border border-slate-200 object-cover" />
                </a>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {(it.status === "PENDING" || it.status === "FAILED") && (
                  <button
                    onClick={() => void generate(it.id)}
                    disabled={busyId === it.id}
                    className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                  >
                    {busyId === it.id ? "Generating…" : it.status === "FAILED" ? "Retry generation" : "Generate now"}
                  </button>
                )}
                {(it.status === "PENDING" || it.status === "READY") && (
                  <>
                    <button onClick={() => void setStatus(it.id, "APPROVED")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Approve</button>
                    <button onClick={() => void setStatus(it.id, "REJECTED")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Reject</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
