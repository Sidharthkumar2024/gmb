"use client";

// Description optimizer — improve a business/service/product description against
// target keywords and a length limit, preview the result (AI when configured,
// a template otherwise), then save it as a generate-then-approve draft.
// Backed by /api/v1/gmb/descriptions (+ /optimize).

import { FormEvent, useCallback, useEffect, useState } from "react";
import { GmbShell, useActiveLocationId } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
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

const STATUS_TONE: Record<string, "ok" | "warn" | "neutral"> = {
  APPROVED: "ok",
  DRAFT: "warn",
  REJECTED: "neutral",
};

const inputCls =
  "w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 text-gmb-ink outline-none placeholder:text-gmb-ink-subtle focus:border-gmb-brand";
const labelCls = "block text-micro uppercase tracking-wide text-gmb-ink-subtle";

export default function GmbDescriptionsPage() {
  const locationId = useActiveLocationId();
  const [target, setTarget] = useState<string>("BUSINESS");
  const [label, setLabel] = useState("");
  const [original, setOriginal] = useState("");
  const [keywords, setKeywords] = useState("");
  const [maxLength, setMaxLength] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [tone, setTone] = useState<string>("professional");

  const [preview, setPreview] = useState<OptimizeResult | null>(null);
  const [drafts, setDrafts] = useState<Description[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function reqBody() {
    return {
      text: original,
      original,
      target,
      label: label.trim() || undefined,
      keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
      maxLength: maxLength ? Number(maxLength) : undefined,
      businessName: businessName.trim() || undefined,
      tone,
      // The active location (from the shell switcher) is where saved drafts land.
      locationId: locationId || undefined,
    };
  }

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const q = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
      setDrafts((await api.get<Description[]>(`/api/v1/gmb/descriptions${q}`)) ?? []);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load descriptions.");
      setDrafts([]);
    }
  }, [locationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runPreview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    setBusy("preview");
    try {
      setPreview(await api.post<OptimizeResult>("/api/v1/gmb/descriptions/optimize", reqBody()));
    } catch (e2) {
      setErr(e2 instanceof ApiClientError ? e2.message : "Unable to optimize.");
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    setErr(null);
    setBusy("save");
    try {
      await api.post("/api/v1/gmb/descriptions", reqBody());
      setNotice("Draft saved for approval.");
      setPreview(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to save draft.");
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(id: string, status: "APPROVED" | "REJECTED") {
    setBusy(id);
    try {
      await api.patch(`/api/v1/gmb/descriptions/${id}`, { status });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to update status.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this draft?")) return;
    setBusy(id);
    try {
      await api.delete(`/api/v1/gmb/descriptions/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <GmbShell title="Descriptions">
      {err && <ErrorNote>{err}</ErrorNote>}
      {notice && (
        <div className="mb-3.5 rounded-control border border-gmb-ok/30 bg-gmb-ok/10 px-3 py-2 text-sm2 text-gmb-ok">
          {notice}
        </div>
      )}

      <div className="grid gap-3.5 lg:grid-cols-[380px_1fr] lg:items-start">
        {/* Optimize form */}
        <Card>
          <SectionLabel>Optimize a description</SectionLabel>
          <p className="mt-1 text-xs2 text-gmb-ink-muted">
            Preview an improved version against your keywords, then save it for approval — nothing
            publishes on its own.
          </p>
          <form onSubmit={runPreview} className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className={labelCls}>
                Target
                <select value={target} onChange={(e) => setTarget(e.target.value)} className={`mt-1 ${inputCls}`}>
                  {TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Tone
                <select value={tone} onChange={(e) => setTone(e.target.value)} className={`mt-1 ${inputCls}`}>
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={labelCls}>
              Original description
              <textarea
                value={original}
                onChange={(e) => setOriginal(e.target.value)}
                required
                rows={4}
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className={labelCls}>
              Target keywords (comma-separated)
              <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className={`mt-1 ${inputCls}`} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={labelCls}>
                Max length
                <input
                  type="number"
                  min={20}
                  value={maxLength}
                  onChange={(e) => setMaxLength(e.target.value)}
                  placeholder="none"
                  className={`mt-1 ${inputCls}`}
                />
              </label>
              <label className={labelCls}>
                Label
                <input value={label} onChange={(e) => setLabel(e.target.value)} className={`mt-1 ${inputCls}`} />
              </label>
            </div>
            <label className={labelCls}>
              Business name
              <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className={`mt-1 ${inputCls}`} />
            </label>
            <div className="mt-1 flex gap-2">
              <Button type="submit" variant="ghost" disabled={busy === "preview" || !original.trim()}>
                {busy === "preview" ? "Optimizing…" : "Preview"}
              </Button>
              <Button type="button" disabled={busy === "save" || !original.trim()} onClick={() => void saveDraft()}>
                {busy === "save" ? "Saving…" : "Save draft"}
              </Button>
            </div>
            {!locationId && (
              <p className="text-micro text-gmb-ink-subtle">
                Add a location to save drafts against it — you can still preview without one.
              </p>
            )}
          </form>
        </Card>

        {/* Preview + drafts */}
        <div className="flex flex-col gap-3.5">
          {preview && (
            <Card className="border-gmb-brand-border">
              <div className="flex items-center justify-between gap-2">
                <SectionLabel>Preview</SectionLabel>
                <span className="flex items-center gap-1.5">
                  {preview.source && (
                    <Pill tone={preview.source === "ai" ? "brand" : "neutral"}>
                      {preview.source === "ai" ? "AI" : "Starter"}
                    </Pill>
                  )}
                  {preview.score && (
                    <Pill
                      tone={
                        preview.score.score >= 80 ? "ok" : preview.score.score >= 50 ? "warn" : "danger"
                      }
                    >
                      Quality {preview.score.score}/100
                    </Pill>
                  )}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap rounded-control bg-gmb-canvas px-3 py-2 text-sm2 text-gmb-ink">
                {preview.optimized}
              </p>
              <p className="mt-2 text-xs2 text-gmb-ink-muted">
                {preview.analysis.length} chars · {preview.analysis.wordCount} words ·{" "}
                {preview.analysis.withinLimit ? "within limit" : "over limit"}
                {preview.analysis.missingKeywords.length > 0 &&
                  ` · missing: ${preview.analysis.missingKeywords.join(", ")}`}
              </p>
              {preview.changes.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs2 text-gmb-ink-muted">
                  {preview.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <Button disabled={busy === "save"} onClick={() => void saveDraft()}>
                  {busy === "save" ? "Saving…" : "Save this draft"}
                </Button>
              </div>
            </Card>
          )}

          <div>
            <SectionLabel>Saved drafts</SectionLabel>
            <div className="mt-2 flex flex-col gap-3">
              {drafts === null ? (
                <Skeleton className="h-28" />
              ) : drafts.length === 0 ? (
                <EmptyState
                  title="No drafts yet"
                  body="Preview an optimized description above and save it here for approval."
                />
              ) : (
                drafts.map((d) => (
                  <Card key={d.id}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm2 font-semibold text-gmb-ink">
                        {d.target}
                        {d.label ? ` · ${d.label}` : ""}
                      </span>
                      <div className="flex items-center gap-2">
                        <Pill tone={STATUS_TONE[d.status]}>{d.status}</Pill>
                        <button
                          type="button"
                          disabled={busy === d.id}
                          onClick={() => void remove(d.id)}
                          className="text-xs2 text-gmb-ink-subtle hover:text-gmb-danger disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {d.optimized && (
                      <p className="mt-2 whitespace-pre-wrap text-sm2 text-gmb-ink-muted">{d.optimized}</p>
                    )}
                    {d.analysis && d.analysis.issues.length > 0 && (
                      <p className="mt-1 text-xs2 text-[#a9761f]">{d.analysis.issues.join(" · ")}</p>
                    )}
                    {d.status === "DRAFT" && (
                      <div className="mt-3 flex gap-2">
                        <Button disabled={busy === d.id} onClick={() => void setStatus(d.id, "APPROVED")}>
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy === d.id}
                          onClick={() => void setStatus(d.id, "REJECTED")}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </GmbShell>
  );
}
