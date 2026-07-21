"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Action links — the Book / Order / Reserve buttons on a Google profile.
//
// Two things this screen must not fudge:
//   * Links are https-only. The API rejects anything else, so the UI says so
//     up front rather than letting someone type http:// and get a 400.
//   * publishedToGoogle is shown per link. A saved link is stored here; it
//     reaches the profile once a Google connection is live. Implying otherwise
//     would have owners believe a booking button is live when it is not.

type ActionType = "BOOK" | "APPOINTMENT" | "RESERVE" | "ORDER_ONLINE" | "DINING_RESERVATION";

const TYPES: Array<{ key: ActionType; label: string; blurb: string }> = [
  { key: "BOOK", label: "Book", blurb: "General booking button" },
  { key: "APPOINTMENT", label: "Appointment", blurb: "Appointment scheduling" },
  { key: "RESERVE", label: "Reserve", blurb: "Table or slot reservation" },
  { key: "ORDER_ONLINE", label: "Order online", blurb: "Online ordering" },
  { key: "DINING_RESERVATION", label: "Dining reservation", blurb: "Restaurant bookings" },
];

interface PlaceAction {
  id: string;
  locationId: string;
  actionType: ActionType;
  url: string;
  isActive: boolean;
  publishedToGoogle: boolean;
}

interface LocationLite {
  id: string;
  name: string;
}

export default function GmbActionsPage() {
  const [locations, setLocations] = useState<LocationLite[]>([]);
  const [locationId, setLocationId] = useState("");
  const [actions, setActions] = useState<PlaceAction[] | null>(null);
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

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
    if (!locationId) return;
    setError(null);
    try {
      const [list, suggest] = await Promise.all([
        api.get<PlaceAction[]>(`/api/v1/gmb/place-actions?locationId=${locationId}`),
        api
          .get<{ bookingUrl: string; bookingUrlValid: boolean }>(
            `/api/v1/gmb/place-actions/suggest?locationId=${locationId}`,
          )
          .catch(() => null),
      ]);
      setActions(list ?? []);
      // Only offer the shortcut when the API says the URL is actually usable —
      // on localhost it is http:// and would be rejected on save.
      setBookingUrl(suggest?.bookingUrlValid ? suggest.bookingUrl : null);
      const seeded: Record<string, string> = {};
      for (const a of list ?? []) seeded[a.actionType] = a.url;
      setDrafts(seeded);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load action links.");
      setActions([]);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(actionType: ActionType) {
    const url = (drafts[actionType] ?? "").trim();
    if (!url) return;
    setBusy((b) => ({ ...b, [actionType]: "save" }));
    setError(null);
    try {
      await api.put("/api/v1/gmb/place-actions", { locationId, actionType, url });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the link.");
    } finally {
      setBusy((b) => ({ ...b, [actionType]: "" }));
    }
  }

  async function toggle(a: PlaceAction) {
    setBusy((b) => ({ ...b, [a.actionType]: "toggle" }));
    try {
      await api.patch(`/api/v1/gmb/place-actions/${a.id}`, { isActive: !a.isActive });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update the link.");
    } finally {
      setBusy((b) => ({ ...b, [a.actionType]: "" }));
    }
  }

  async function remove(a: PlaceAction) {
    setBusy((b) => ({ ...b, [a.actionType]: "delete" }));
    try {
      await api.delete(`/api/v1/gmb/place-actions/${a.id}`);
      setDrafts((d) => ({ ...d, [a.actionType]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not remove the link.");
    } finally {
      setBusy((b) => ({ ...b, [a.actionType]: "" }));
    }
  }

  const byType = new Map((actions ?? []).map((a) => [a.actionType, a]));

  return (
    <GmbShell title="Action links">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className="mb-3.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionLabel>Buttons on your Google profile</SectionLabel>
            <div className="mt-1 max-w-xl text-sm2 text-gmb-ink-muted">
              One link per action type. Links must be <strong>https</strong>. They are saved here
              and pushed to your profile once your Google connection is live.
            </div>
          </div>
          {locations.length > 1 && (
            <label className="font-geist-mono text-micro uppercase tracking-wide text-gmb-ink-subtle">
              Location
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="mt-1 block rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 font-normal normal-case tracking-normal text-gmb-ink outline-none"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Card>

      {actions === null ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {TYPES.map((t) => {
            const existing = byType.get(t.key);
            const working = busy[t.key];
            const value = drafts[t.key] ?? "";
            const changed = existing ? value.trim() !== existing.url : value.trim().length > 0;
            return (
              <Card key={t.key}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold">{t.label}</span>
                      {existing && !existing.isActive && <Pill>Hidden</Pill>}
                      {existing &&
                        (existing.publishedToGoogle ? (
                          <Pill tone="ok">On Google</Pill>
                        ) : (
                          <Pill tone="warn">Saved, not yet on Google</Pill>
                        ))}
                    </div>
                    <div className="mt-0.5 text-micro text-gmb-ink-subtle">{t.blurb}</div>
                  </div>
                  {existing && (
                    <div className="flex gap-1.5">
                      <Button
                        variant="ghost"
                        disabled={Boolean(working)}
                        onClick={() => void toggle(existing)}
                      >
                        {existing.isActive ? "Hide" : "Show"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={Boolean(working)}
                        onClick={() => void remove(existing)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-2.5 flex flex-wrap gap-2">
                  <input
                    type="url"
                    value={value}
                    onChange={(e) => setDrafts((d) => ({ ...d, [t.key]: e.target.value }))}
                    placeholder="https://your-site.com/book"
                    className="min-w-[260px] flex-1 rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 outline-none focus:border-gmb-brand-border"
                  />
                  {bookingUrl && (t.key === "BOOK" || t.key === "APPOINTMENT") && (
                    <Button
                      variant="ghost"
                      onClick={() => setDrafts((d) => ({ ...d, [t.key]: bookingUrl }))}
                    >
                      Use my booking page
                    </Button>
                  )}
                  <Button
                    disabled={Boolean(working) || !value.trim() || !changed}
                    onClick={() => void save(t.key)}
                  >
                    {working === "save" ? "Saving…" : existing ? "Update" : "Save"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </GmbShell>
  );
}
