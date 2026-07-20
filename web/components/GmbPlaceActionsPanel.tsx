"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiClientError } from "../lib/api";

// GBP Place Actions panel (Adgrowly GMB Panel — "Place Actions API"). Manages
// the action links on a Business Profile (Book / Appointment / Reserve / Order
// / Dining), pre-fillable from the tenant's own booking page. Self-contained:
// pass the location list and it manages its own selection + state.

const ACTION_TYPES = [
  { key: "BOOK", label: "Book" },
  { key: "APPOINTMENT", label: "Appointment" },
  { key: "RESERVE", label: "Reserve" },
  { key: "ORDER_ONLINE", label: "Order online" },
  { key: "DINING_RESERVATION", label: "Dining reservation" },
] as const;

type ActionType = (typeof ACTION_TYPES)[number]["key"];

interface PlaceAction {
  id: string;
  locationId: string;
  actionType: ActionType;
  url: string;
  isActive: boolean;
  publishedToGoogle: boolean;
  updatedAt: string;
}

export function GmbPlaceActionsPanel({
  locations,
}: {
  locations: Array<{ id: string; name: string }>;
}) {
  const [locationId, setLocationId] = useState<string>("");
  const [actions, setActions] = useState<PlaceAction[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<ActionType, string>>>({});
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Default to the first location once the list arrives.
  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setErr(null);
    try {
      const [list, suggest] = await Promise.all([
        api.get<PlaceAction[]>(`/api/v1/gmb/place-actions?locationId=${locationId}`),
        api.get<{ bookingUrl: string }>(
          `/api/v1/gmb/place-actions/suggest?locationId=${locationId}`,
        ),
      ]);
      setActions(list);
      setBookingUrl(suggest.bookingUrl);
      // Seed the draft inputs from any saved links.
      const seeded: Partial<Record<ActionType, string>> = {};
      for (const a of list) seeded[a.actionType] = a.url;
      setDrafts(seeded);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not load action links.");
    }
  }, [locationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const savedByType = useMemo(() => {
    const m: Partial<Record<ActionType, PlaceAction>> = {};
    for (const a of actions) m[a.actionType] = a;
    return m;
  }, [actions]);

  async function save(type: ActionType) {
    const url = (drafts[type] ?? "").trim();
    if (!url || !locationId) return;
    setBusy(`save-${type}`);
    setErr(null);
    try {
      await api.put("/api/v1/gmb/place-actions", { locationId, actionType: type, url });
      setNotice(`${type.replace("_", " ").toLowerCase()} link saved.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not save the link.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(`del-${id}`);
    try {
      await api.delete(`/api/v1/gmb/place-actions/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not remove the link.");
    } finally {
      setBusy(null);
    }
  }

  function useBooking(type: ActionType) {
    if (bookingUrl) setDrafts((d) => ({ ...d, [type]: bookingUrl }));
  }

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Action links</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Booking, appointment and order buttons that appear on your Google profile. Use your
            own booking page in one click.
          </p>
        </div>
        {locations.length > 1 && (
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {err && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}
      {notice && !err && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {notice}
        </div>
      )}

      {!locationId ? (
        <p className="mt-4 text-sm text-slate-400">Add a location to manage its action links.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {ACTION_TYPES.map(({ key, label }) => {
            const saved = savedByType[key];
            return (
              <div key={key} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{label}</span>
                  {saved && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        saved.publishedToGoogle
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {saved.publishedToGoogle ? "on Google" : "saved · not yet on Google"}
                    </span>
                  )}
                  {(key === "BOOK" || key === "APPOINTMENT") && bookingUrl && (
                    <button
                      type="button"
                      onClick={() => useBooking(key)}
                      className="ml-auto text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      Use my booking page →
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="url"
                    value={drafts[key] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    placeholder="https://…"
                    className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void save(key)}
                    disabled={busy === `save-${key}` || !(drafts[key] ?? "").trim()}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busy === `save-${key}` ? "Saving…" : saved ? "Update" : "Save"}
                  </button>
                  {saved && (
                    <button
                      type="button"
                      onClick={() => void remove(saved.id)}
                      disabled={busy === `del-${saved.id}`}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-slate-400">
            Links must be https. They&apos;re saved here now and pushed to your Google profile once
            your Google Business account is connected.
          </p>
        </div>
      )}
    </div>
  );
}
