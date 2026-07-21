"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Locations — the profile hub.
//
// One row per Google Business location with its connection state, rating and
// review count. `hasCredential` and `status` are shown separately because a
// location can exist locally (DRAFT) long before a Google credential is
// attached; conflating them would tell the operator they are connected when
// nothing will actually sync.

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
  status: "DRAFT" | "CONNECTED" | "SUSPENDED";
  verificationState: string | null;
  rating: number | null;
  reviewCount: number | null;
  hasCredential: boolean;
}

const STATUS_TONE = {
  CONNECTED: "ok",
  DRAFT: "neutral",
  SUSPENDED: "danger",
} as const;

const BLANK = {
  name: "",
  primaryCategory: "",
  phone: "",
  addressLine: "",
  city: "",
  region: "",
  postalCode: "",
};

function formatAddress(a: Location["address"]): string {
  return [a.line, a.city, a.region, a.postalCode].filter(Boolean).join(", ") || "No address on file";
}

export default function GmbLocationsPage() {
  const [items, setItems] = useState<Location[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...BLANK });

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

  async function create() {
    if (!form.name.trim()) return;
    setBusy((b) => ({ ...b, __new: "1" }));
    setError(null);
    try {
      // Only send fields the operator filled in; empty strings would overwrite
      // with blanks rather than leave the column null.
      const body = Object.fromEntries(
        Object.entries(form)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => v !== ""),
      );
      await api.post("/api/v1/gmb/locations", body);
      setForm({ ...BLANK });
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not add the location.");
    } finally {
      setBusy((b) => ({ ...b, __new: "" }));
    }
  }

  async function sync(id: string) {
    setBusy((b) => ({ ...b, [id]: "sync" }));
    setError(null);
    try {
      await api.post(`/api/v1/gmb/locations/${id}/sync`, {});
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not sync the location.");
    } finally {
      setBusy((b) => ({ ...b, [id]: "" }));
    }
  }

  async function remove(id: string) {
    setBusy((b) => ({ ...b, [id]: "delete" }));
    try {
      await api.delete(`/api/v1/gmb/locations/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not remove the location.");
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
          <SectionLabel>Connected</SectionLabel>
          <div
            className={`mt-1.5 text-[28px] font-bold tracking-[-0.02em] ${
              items && connected === items.length && items.length > 0
                ? "text-gmb-ok"
                : "text-gmb-warn"
            }`}
          >
            {items ? connected : "—"}
          </div>
          <div className="mt-1 text-xs2 text-gmb-ink-muted">syncing with Google</div>
        </Card>
        <Card className="col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SectionLabel>Add a location</SectionLabel>
              <div className="mt-1 text-xs2 text-gmb-ink-muted">
                Add it here first, then connect Google to start syncing reviews
                and insights.
              </div>
            </div>
            <Button variant={adding ? "ghost" : "primary"} onClick={() => setAdding((v) => !v)}>
              {adding ? "Cancel" : "Add location"}
            </Button>
          </div>
        </Card>
      </div>

      {adding && (
        <Card className="mb-3.5">
          <SectionLabel>New location</SectionLabel>
          <div className="mt-3 grid grid-cols-4 gap-2.5">
            {(
              [
                ["name", "Business name *"],
                ["primaryCategory", "Category"],
                ["phone", "Phone"],
                ["addressLine", "Address"],
                ["city", "City"],
                ["region", "State / region"],
                ["postalCode", "Postal code"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="text-micro font-semibold uppercase tracking-wide text-gmb-ink-subtle"
              >
                {label}
                <input
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="mt-1 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none focus:border-gmb-brand-border"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button disabled={!form.name.trim() || busy.__new === "1"} onClick={() => void create()}>
              {busy.__new === "1" ? "Saving…" : "Save location"}
            </Button>
          </div>
        </Card>
      )}

      {items === null ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No locations yet"
          body="Add your first Google Business location to start tracking reviews, rankings and posts."
          action={<Button onClick={() => setAdding(true)}>Add location</Button>}
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
                      <span className="text-[14px] font-semibold">{l.name}</span>
                      <Pill tone={STATUS_TONE[l.status]}>{l.status.toLowerCase()}</Pill>
                      {/* Connection state and credential are distinct: a DRAFT
                          row with no credential will never sync, and saying
                          otherwise would be misleading. */}
                      {!l.hasCredential && <Pill tone="warn">No Google credential</Pill>}
                      {l.verificationState && (
                        <Pill tone={l.verificationState === "VERIFIED" ? "ok" : "neutral"}>
                          {l.verificationState.toLowerCase()}
                        </Pill>
                      )}
                    </div>
                    <div className="mt-1.5 text-sm2 text-gmb-ink-muted">
                      {formatAddress(l.address)}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-4 font-geist-mono text-micro text-gmb-ink-subtle">
                      {l.primaryCategory && <span>{l.primaryCategory}</span>}
                      {l.phone && <span>{l.phone}</span>}
                      <span>
                        {typeof l.rating === "number"
                          ? `${l.rating.toFixed(1)}★ · ${l.reviewCount ?? 0} reviews`
                          : "no rating synced"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 gap-1.5">
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
                      onClick={() => void remove(l.id)}
                    >
                      Remove
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
