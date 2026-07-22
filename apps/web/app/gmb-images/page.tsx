"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Photos — AI-generated profile imagery.
//
// Generate-then-approve, like every other AI surface here: a prompt is built,
// a request is created PENDING, generation fills resultUrl and flips it to
// READY, and only an explicit approve marks it APPROVED. Nothing is pushed to
// the Google profile automatically. When no image provider key is configured,
// generation fails with a clear message rather than a broken image.

type ImageStatus = "PENDING" | "READY" | "FAILED" | "APPROVED" | "REJECTED";

interface ImageRequest {
  id: string;
  locationId: string | null;
  subject: string;
  prompt: string;
  style: string | null;
  palette: string | null;
  size: string;
  aspect: string;
  status: ImageStatus;
  resultUrl: string | null;
  error: string | null;
  createdAt: string;
}

interface LocationLite {
  id: string;
  name: string;
}

const STATUS_TONE: Record<ImageStatus, "neutral" | "warn" | "ok" | "danger" | "brand"> = {
  PENDING: "warn",
  READY: "brand",
  APPROVED: "ok",
  FAILED: "danger",
  REJECTED: "neutral",
};

const STYLES = ["photograph", "illustration", "flat design", "minimal", "vibrant"];
const PALETTES = ["warm", "cool", "monochrome", "brand colours", "natural"];

export default function GmbImagesPage() {
  const [locations, setLocations] = useState<LocationLite[]>([]);
  const [locationId, setLocationId] = useState("");
  const [items, setItems] = useState<ImageRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Composer
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [style, setStyle] = useState("photograph");
  const [palette, setPalette] = useState("warm");
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<LocationLite[]>("/api/v1/gmb/locations")
      .then((rows) => {
        setLocations(rows ?? []);
        const saved = window.localStorage.getItem("gmb_active_location");
        setLocationId(rows?.some((r) => r.id === saved) ? saved! : (rows?.[0]?.id ?? ""));
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = locationId ? `?locationId=${locationId}` : "";
      setItems((await api.get<ImageRequest[]>(`/api/v1/gmb/images${qs}`)) ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load images.");
      setItems([]);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function buildPreview() {
    if (!subject.trim()) return;
    setBusy("preview");
    setError(null);
    try {
      const r = await api.post<{ prompt: string }>("/api/v1/gmb/images/prompt", {
        subject: subject.trim(),
        style,
        palette,
      });
      setPreview(r.prompt);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not build the prompt.");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!subject.trim()) return;
    setBusy("create");
    setError(null);
    try {
      await api.post("/api/v1/gmb/images", {
        subject: subject.trim(),
        style,
        palette,
        ...(locationId ? { locationId } : {}),
      });
      setSubject("");
      setPreview(null);
      setOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not create the request.");
    } finally {
      setBusy(null);
    }
  }

  async function generate(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.post(`/api/v1/gmb/images/${id}/generate`, {});
      await load();
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : "Could not generate. An image provider key is required.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(id: string, status: ImageStatus) {
    setBusy(id);
    try {
      await api.patch(`/api/v1/gmb/images/${id}`, { status });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update the image.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await api.delete(`/api/v1/gmb/images/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not delete the image.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <GmbShell title="Photos">
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Composer */}
      <Card className="mb-3.5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SectionLabel>Create a photo with AI</SectionLabel>
            <div className="mt-1 max-w-xl text-sm2 text-gmb-ink-muted">
              Describe what you want; AI writes the image prompt and generates it. Every image
              waits for your approval before it can go on your profile.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {locations.length > 1 && (
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 outline-none"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
            <Button variant={open ? "ghost" : "primary"} onClick={() => setOpen((v) => !v)}>
              {open ? "Close" : "New photo"}
            </Button>
          </div>
        </div>

        {open && (
          <div className="mt-4 border-t border-gmb-line-soft pt-4">
            <label className="font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle">
              What should it show?
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. a bright, welcoming salon interior with a stylist at work"
                className="mt-1 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none focus:border-gmb-brand-border"
              />
            </label>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <label className="font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle">
                Style
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="mt-1 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none"
                >
                  {STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle">
                Palette
                <select
                  value={palette}
                  onChange={(e) => setPalette(e.target.value)}
                  className="mt-1 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none"
                >
                  {PALETTES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {preview && (
              <div className="mt-2.5 rounded-control border border-gmb-line bg-gmb-subtle p-3">
                <div className="font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle">
                  Generated prompt
                </div>
                <p className="mt-1 text-sm2 leading-relaxed text-gmb-ink">{preview}</p>
              </div>
            )}

            <div className="mt-2.5 flex justify-end gap-1.5">
              <Button variant="ghost" disabled={!subject.trim() || busy === "preview"} onClick={() => void buildPreview()}>
                {busy === "preview" ? "Building…" : "Preview prompt"}
              </Button>
              <Button disabled={!subject.trim() || busy === "create"} onClick={() => void create()}>
                {busy === "create" ? "Saving…" : "Create request"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Gallery */}
      {items === null ? (
        <div className="grid grid-cols-3 gap-3.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No photos yet"
          body="Describe a photo above and AI will draft the prompt and generate it — you approve before anything reaches your Google profile."
        />
      ) : (
        <div className="grid grid-cols-3 gap-3.5">
          {items.map((img) => {
            const working = busy === img.id;
            return (
              <Card key={img.id} padded={false} className="overflow-hidden">
                {/* Preview area */}
                <div className="relative flex aspect-[4/3] items-center justify-center bg-gmb-subtle">
                  {img.resultUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img.resultUrl}
                      alt={img.subject}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="px-4 text-center">
                      <Pill tone={STATUS_TONE[img.status]}>{img.status}</Pill>
                      <div className="mt-2 text-micro text-gmb-ink-subtle">
                        {img.status === "PENDING"
                          ? "Not generated yet"
                          : img.status === "FAILED"
                            ? "Generation failed"
                            : "No preview"}
                      </div>
                    </div>
                  )}
                  <span className="absolute right-2 top-2">
                    <Pill tone={STATUS_TONE[img.status]}>{img.status}</Pill>
                  </span>
                </div>

                <div className="p-3.5">
                  <div className="truncate text-[13px] font-semibold" title={img.subject}>
                    {img.subject}
                  </div>
                  <div className="mt-0.5 font-geist-mono text-micro text-gmb-ink-subtle">
                    {[img.style, img.palette, img.aspect].filter(Boolean).join(" · ")}
                  </div>
                  {img.error && (
                    <div className="mt-2 rounded-control bg-gmb-danger-bg px-2.5 py-1.5 text-micro text-gmb-danger">
                      {img.error}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(img.status === "PENDING" || img.status === "FAILED") && (
                      <Button disabled={working} onClick={() => void generate(img.id)}>
                        {working ? "Generating…" : img.status === "FAILED" ? "Retry" : "Generate"}
                      </Button>
                    )}
                    {img.status === "READY" && (
                      <>
                        <Button disabled={working} onClick={() => void setStatus(img.id, "APPROVED")}>
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={working}
                          onClick={() => void setStatus(img.id, "REJECTED")}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" disabled={working} onClick={() => void remove(img.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </GmbShell>
  );
}
