"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Locations — the profile roster.
//
// Status here is deliberately literal. DRAFT means "we hold this record
// locally"; CONNECTED means a Google credential is attached. Verification is a
// separate axis (Google's own state) and is shown as its own chip, because a
// location can be connected but unverified, and conflating the two would tell
// an owner they are live on Google when they are not.

interface Location {
  id: string;
  name: string;
  storeCode: string | null;
  placeId: string | null;
  phone: string | null;
  website: string | null;
  primaryCategory: string | null;
  address: {
    line: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
  };
  latitude: number | null;
  longitude: number | null;
  status: "DRAFT" | "CONNECTED" | "SUSPENDED";
  verificationState: string | null;
  rating: number | null;
  reviewCount: number | null;
  hasCredential: boolean;
  lastSyncedAt: string | null;
}

const STATUS_TONE = {
  DRAFT: "neutral",
  CONNECTED: "ok",
  SUSPENDED: "danger",
} as const;

function formatAddress(a: Location["address"]): string {
  return [a.line, a.city, a.region, a.postalCode].filter(Boolean).join(", ") || "No address yet";
}

function isVerified(state: string | null): boolean {
  const s = (state ?? "").trim().toUpperCase();
  return s === "VERIFIED" || s === "COMPLETED";
}

export default function GmbLocationsPage() {
  const [items, setItems] = useState<Location[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", city: "", primaryCategory: "", phone: "" });

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await api.get<Location[]>("/api/v1/gmb/locations")) ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load locations.");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy((b) => ({ ...b, __new: "1" }));
    setError(null);
    try {
      await api.post("/api/v1/gmb/locations", {
        name: form.name.trim(),
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.primaryCategory.trim() ? { primaryCategory: form.primaryCategory.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      });
      setForm({ name: "", city: "", primaryCategory: "", phone: "" });
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add the location.");
    } finally {
      setBusy((b) => ({ ...b, __new: "" }));
    }
  }

  async function remove(id: string, name: string) {
    // Deleting a location takes its reviews, rankings and posts with it, so
    // make the owner confirm against the actual name rather than a generic
    // "are you sure".
    if (!window.confirm(`Delete "${name}"? Its reviews, rankings and posts go with it.`)) return;
    setBusy((b) => ({ ...b, [id]: "delete" }));
    try {
      await api.delete(`/api/v1/gmb/locations/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not delete the location.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  // Grid rank tracking needs coordinates, and the rank tracker's own error
  // tells the owner to "edit the location" — so that has to be possible here.
  async function setCoords(l: Location) {
    const current = l.latitude !== null && l.longitude !== null ? `${l.latitude}, ${l.longitude}` : "";
    const raw = window.prompt(
      `Coordinates for "${l.name}"\n\nPaste "latitude, longitude" — right-click the pin in Google Maps and the first item is exactly this.`,
      current,
    );
    if (raw === null) return;
    const [latStr, lngStr] = raw.split(",").map((s) => s.trim());
    const latitude = Number(latStr);
    const longitude = Number(lngStr);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError('Coordinates must look like "43.6532, -79.3832".');
      return;
    }
    setBusy((b) => ({ ...b, [l.id]: "coords" }));
    setError(null);
    try {
      await api.patch(`/api/v1/gmb/locations/${l.id}`, { latitude, longitude });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the coordinates.");
    } finally {
      setBusy((b) => ({ ...b, [l.id]: "" }));
    }
  }

  async function sync(id: string) {
    setBusy((b) => ({ ...b, [id]: "sync" }));
    setError(null);
    try {
      await api.post(`/api/v1/gmb/locations/${id}/sync`, {});
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not sync this location.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  const connected = (items ?? []).filter((l) => l.status === "CONNECTED").length;

  return (
    <GmbShell title="Locations">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-3.5 grid grid-cols-4 gap-3.5">
        <Card>
          <SectionLabel>Locations</SectionLabel>
          <div className="mt-1.5 text-[28px] font-bold tracking-[-0.02em]">
            {items?.length ?? "—"}
          </div>
        </Card>
        <Card>
          <SectionLabel>Connected to Google</SectionLabel>
          <div
            className={`mt-1.5 text-[28px] font-bold tracking-[-0.02em] ${
              items && connected === items.length && items.length > 0 ? "text-gmb-ok" : ""
            }`}
          >
            {items ? connected : "—"}
          </div>
          <div className="mt-1 text-xs2 text-gmb-ink-muted">
            {items && items.length > connected
              ? `${items.length - connected} still local`
              : "all linked"}
          </div>
        </Card>
        <Card className="col-span-2">
          <SectionLabel>Add a location</SectionLabel>
          <div className="mt-1 text-xs2 text-gmb-ink-muted">
            Add it here now; connect it to Google whenever you&rsquo;re ready.
          </div>
          <div className="mt-2.5">
            <Button variant="ghost" onClick={() => setAdding((v) => !v)}>
              {adding ? "Cancel" : "New location"}
            </Button>
            <Link href="/gmb-connect" className="ml-2 no-underline hover:no-underline">
              <span className="inline-block rounded-control bg-gmb-night px-4 py-2 text-sm2 font-semibold text-white">
                Import from Google
              </span>
            </Link>
          </div>
        </Card>
      </div>

      {adding && (
        <Card className="mb-3.5">
          <form onSubmit={create} className="grid grid-cols-4 items-end gap-2.5">
            {(
              [
                ["name", "Business name", "Maple Dental Studio", true],
                ["city", "City", "Toronto", false],
                ["primaryCategory", "Category", "Dentist", false],
                ["phone", "Phone", "+1 416 555 0100", false],
              ] as const
            ).map(([key, label, placeholder, required]) => (
              <label
                key={key}
                className="font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle"
              >
                {label}
                <input
                  required={required}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="mt-1 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none focus:border-gmb-brand-border"
                />
              </label>
            ))}
            <div className="col-span-4 flex justify-end">
              <Button type="submit" disabled={!form.name.trim() || busy.__new === "1"}>
                {busy.__new === "1" ? "Adding…" : "Add location"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {items === null ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No locations yet"
          body="Add your business above, or import everything you manage straight from Google."
          action={
            <Link href="/gmb-connect" className="no-underline hover:no-underline">
              <span className="inline-block rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white">
                Connect Google
              </span>
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((l) => {
            const working = busy[l.id];
            return (
              <Card key={l.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{l.name}</span>
                      <Pill tone={STATUS_TONE[l.status]}>
                        {l.status === "CONNECTED" ? "Connected" : l.status === "DRAFT" ? "Local only" : "Suspended"}
                      </Pill>
                      {isVerified(l.verificationState) ? (
                        <Pill tone="ok">Verified on Google</Pill>
                      ) : (
                        <Pill>Not verified</Pill>
                      )}
                      {l.primaryCategory && (
                        <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                          {l.primaryCategory}
                        </span>
                      )}
                      {l.latitude === null || l.longitude === null ? (
                        <Pill tone="warn">No coordinates</Pill>
                      ) : null}
                    </div>
                    <div className="mt-1.5 text-sm2 text-gmb-ink-muted">{formatAddress(l.address)}</div>
                    <div className="mt-2 flex flex-wrap gap-4 font-geist-mono text-micro text-gmb-ink-subtle">
                      {typeof l.rating === "number" && l.reviewCount ? (
                        <span>
                          {l.rating.toFixed(1)}★ · {l.reviewCount} reviews
                        </span>
                      ) : (
                        <span>No reviews synced</span>
                      )}
                      {l.phone && <span>{l.phone}</span>}
                      <span>
                        {l.lastSyncedAt
                          ? `synced ${new Date(l.lastSyncedAt).toLocaleDateString()}`
                          : "never synced"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                    <div className="flex gap-1.5">
                      <Button
                        variant={l.latitude === null ? "primary" : "ghost"}
                        disabled={Boolean(working)}
                        onClick={() => void setCoords(l)}
                      >
                        {working === "coords"
                          ? "Saving…"
                          : l.latitude === null
                            ? "Set coordinates"
                            : "Coordinates"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={Boolean(working)}
                        onClick={() => void sync(l.id)}
                      >
                        {working === "sync" ? "Syncing…" : "Sync"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={Boolean(working)}
                        onClick={() => void remove(l.id, l.name)}
                      >
                        Delete
                      </Button>
                    </div>
                    <div className="flex gap-2 text-micro">
                      <Link href="/gmb-actions" className="text-gmb-brand">
                        Action links
                      </Link>
                      <Link href="/gmb-verifications" className="text-gmb-brand">
                        Verify
                      </Link>
                    </div>
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
