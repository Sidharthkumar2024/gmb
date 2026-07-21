"use client";

import { useCallback, useEffect, useState } from "react";
import { GmbShell, useActiveLocationId } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

// Action links — the Book / Order / Reserve buttons on the Google profile.
//
// One link per action type (the backend enforces that with a unique
// constraint). URLs must be https: an http link is rejected server-side, so
// the field validates before sending rather than letting the operator fill in
// a form that will bounce.

type ActionType = "BOOK" | "APPOINTMENT" | "RESERVE" | "ORDER_ONLINE" | "DINING_RESERVATION";

interface PlaceAction {
  id: string;
  locationId: string;
  actionType: ActionType;
  url: string;
  isActive: boolean;
  publishedToGoogle: boolean;
}

const TYPES: Array<{ key: ActionType; label: string; hint: string }> = [
  { key: "BOOK", label: "Book", hint: "General booking page" },
  { key: "APPOINTMENT", label: "Appointment", hint: "Appointment scheduler" },
  { key: "RESERVE", label: "Reserve", hint: "Table or slot reservation" },
  { key: "ORDER_ONLINE", label: "Order online", hint: "Online ordering" },
  { key: "DINING_RESERVATION", label: "Dining reservation", hint: "Restaurant bookings" },
];

function isHttps(u: string): boolean {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}

export default function GmbActionsPage() {
  const locationId = useActiveLocationId();
  const [actions, setActions] = useState<PlaceAction[] | null>(null);
  const [suggest, setSuggest] = useState<{ bookingUrl: string; bookingUrlValid: boolean } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) {
      setActions([]);
      return;
    }
    setError(null);
    try {
      const list = await api.get<PlaceAction[]>(
        `/api/v1/gmb/place-actions?locationId=${locationId}`,
      );
      setActions(list ?? []);
      setDrafts(Object.fromEntries((list ?? []).map((a) => [a.actionType, a.url])));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load action links.");
      setActions([]);
    }
    try {
      setSuggest(
        await api.get<{ bookingUrl: string; bookingUrlValid: boolean }>(
          `/api/v1/gmb/place-actions/suggest?locationId=${locationId}`,
        ),
      );
    } catch {
      // Suggestions are a convenience; their absence must not block the page.
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(actionType: ActionType) {
    const url = (drafts[actionType] ?? "").trim();
    if (!url || !locationId) return;
    if (!isHttps(url)) {
      setError("Action links must be an absolute https:// URL.");
      return;
    }
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
        <SectionLabel>What these do</SectionLabel>
        <div className="mt-1.5 text-sm2 text-gmb-ink-muted">
          These become the Book, Order and Reserve buttons on your Google profile.
          Links must be https. They are saved here and pushed to Google once your
          Business Profile connection is live.
        </div>
        {suggest?.bookingUrl && (
          <div className="mt-3 flex items-center gap-2.5 rounded-control bg-gmb-brand-wash px-3 py-2">
            <span className="flex-1 truncate font-geist-mono text-micro text-gmb-ink-muted">
              Your booking page: {suggest.bookingUrl}
              {!suggest.bookingUrlValid && " (not https — set WEB_URL to an https origin)"}
            </span>
            <Button
              variant="ghost"
              disabled={!suggest.bookingUrlValid}
              onClick={() =>
                setDrafts((d) => ({
                  ...d,
                  BOOK: suggest.bookingUrl,
                  APPOINTMENT: suggest.bookingUrl,
                }))
              }
            >
              Use for Book & Appointment
            </Button>
          </div>
        )}
      </Card>

      {!locationId ? (
        <Card>
          <div className="py-4 text-center text-sm2 text-gmb-ink-muted">
            Select a location in the sidebar to manage its action links.
          </div>
        </Card>
      ) : actions === null ? (
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
            const changed = existing ? value.trim() !== existing.url : value.trim() !== "";
            return (
              <Card key={t.key}>
                <div className="flex items-center gap-4">
                  <div className="w-44 flex-shrink-0">
                    <div className="text-[13px] font-semibold">{t.label}</div>
                    <div className="mt-0.5 text-micro text-gmb-ink-subtle">{t.hint}</div>
                  </div>

                  <input
                    value={value}
                    onChange={(e) => setDrafts((d) => ({ ...d, [t.key]: e.target.value }))}
                    placeholder="https://…"
                    className={`flex-1 rounded-control border bg-gmb-surface px-3 py-2 font-geist-mono text-xs2 outline-none ${
                      value && !isHttps(value)
                        ? "border-gmb-danger text-gmb-danger"
                        : "border-gmb-line text-gmb-ink focus:border-gmb-brand-border"
                    }`}
                  />

                  <div className="flex w-56 flex-shrink-0 items-center justify-end gap-1.5">
                    {existing && (
                      <>
                        <Pill tone={existing.isActive ? "ok" : "neutral"}>
                          {existing.isActive ? "live" : "off"}
                        </Pill>
                        {!existing.publishedToGoogle && <Pill>not on Google yet</Pill>}
                      </>
                    )}
                    {changed && (
                      <Button disabled={Boolean(working)} onClick={() => void save(t.key)}>
                        {working === "save" ? "Saving…" : existing ? "Update" : "Save"}
                      </Button>
                    )}
                    {existing && !changed && (
                      <>
                        <Button
                          variant="ghost"
                          disabled={Boolean(working)}
                          onClick={() => void toggle(existing)}
                        >
                          {existing.isActive ? "Turn off" : "Turn on"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={Boolean(working)}
                          onClick={() => void remove(existing)}
                        >
                          Remove
                        </Button>
                      </>
                    )}
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
