"use client";

// AdGrowly — Business Profile / Locations (planning PDF §3 Connect GMB). The
// anchor entity: create and manage locations; their IDs feed every other GMB
// page. Backed by module 1: /api/v1/gmb/locations.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { GmbPlaceActionsPanel } from "../../src/components/GmbPlaceActionsPanel";
import { GmbVerificationPanel } from "../../src/components/GmbVerificationPanel";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Location {
  id: string;
  name: string;
  placeId: string | null;
  phone: string | null;
  primaryCategory: string | null;
  address: { line: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null };
  status: "DRAFT" | "CONNECTED" | "SUSPENDED";
  rating: number | null;
  reviewCount: number;
  hasCredential: boolean;
  lastSyncedAt: string | null;
}

interface GoogleConnection {
  configured: boolean;
  connected: boolean;
  secretId: string | null;
  label: string | null;
  last4: string | null;
  scopes: string[];
  connectedAt: string | null;
  expiresAt: string | null;
  accountName: string | null;
  lastSyncedAt: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  CONNECTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  DRAFT: "bg-amber-50 text-amber-700 border-amber-200",
  SUSPENDED: "bg-red-50 text-red-700 border-red-200",
};

export default function GmbLocationsPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<Location[]>([]);
  const [connection, setConnection] = useState<GoogleConnection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [phone, setPhone] = useState("");
  const [primaryCategory, setPrimaryCategory] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [accountName, setAccountName] = useState("");
  const [showManualToken, setShowManualToken] = useState(false);

  async function refresh() {
    try {
      setErr(null);
      const [nextItems, nextConnection] = await Promise.all([
        api.get<Location[]>("/api/v1/gmb/locations"),
        api.get<GoogleConnection>("/api/v1/gmb/google/connection"),
      ]);
      setItems(nextItems);
      setConnection(nextConnection);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load locations.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/locations", {
        name: name.trim(),
        placeId: placeId.trim() || undefined,
        phone: phone.trim() || undefined,
        primaryCategory: primaryCategory.trim() || undefined,
        addressLine: addressLine.trim() || undefined,
        city: city.trim() || undefined,
        secretId: connection?.secretId || undefined,
      });
      setName("");
      setPlaceId("");
      setPhone("");
      setPrimaryCategory("");
      setAddressLine("");
      setCity("");
      setNotice("Location created.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to create location.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this location?")) return;
    try {
      await api.delete(`/api/v1/gmb/locations/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  function copyId(id: string) {
    void navigator.clipboard?.writeText(id);
    setNotice("Location ID copied.");
  }

  async function connectGoogle() {
    setBusy("connect");
    setErr(null);
    setNotice(null);
    try {
      const redirectUri = `${window.location.origin}/gmb-connect/callback`;
      const res = await api.get<{ authorizationUrl: string }>(
        `/api/v1/gmb/google/oauth-url?redirectUri=${encodeURIComponent(redirectUri)}`,
      );
      window.location.href = res.authorizationUrl;
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to start Google OAuth.");
    } finally {
      setBusy(null);
    }
  }

  async function saveToken(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("token");
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/google/manual-token", {
        refreshToken: refreshToken.trim(),
        accountName: accountName.trim() || undefined,
      });
      setRefreshToken("");
      setAccountName("");
      setNotice("Google Business Profile token saved securely.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to save Google token.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnectGoogle() {
    if (!window.confirm("Disconnect Google Business Profile and detach credentials from locations?")) return;
    setBusy("disconnect");
    setErr(null);
    try {
      await api.post("/api/v1/gmb/google/disconnect", {});
      setNotice("Google Business Profile disconnected.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to disconnect Google.");
    } finally {
      setBusy(null);
    }
  }

  async function syncGoogleLocations() {
    setBusy("sync-all");
    setErr(null);
    setNotice(null);
    try {
      const res = await api.post<{ accounts: number; created: number; updated: number; total: number }>(
        "/api/v1/gmb/google/sync-locations",
        {},
      );
      setNotice(`Google sync complete: ${res.total} locations (${res.created} new, ${res.updated} updated).`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to sync Google locations.");
    } finally {
      setBusy(null);
    }
  }

  async function syncOne(location: Location) {
    setBusy(location.id);
    setErr(null);
    setNotice(null);
    try {
      const source = location.hasCredential && location.placeId ? "GOOGLE" : "MANUAL";
      const res = await api.post<Location & { importedReviews?: number; updatedReviews?: number; syncSource?: string }>(
        `/api/v1/gmb/locations/${location.id}/sync`,
        { source },
      );
      const reviewText =
        res.syncSource === "GOOGLE"
          ? ` Imported ${res.importedReviews ?? 0}, updated ${res.updatedReviews ?? 0} reviews.`
          : "";
      setNotice(`${location.name} synced.${reviewText}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to sync location.");
    } finally {
      setBusy(null);
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Business locations</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Connect Google Business Profile, sync locations and pull review stats into AdGrowly.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <section className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Google Business Profile connection</h2>
            <p className="mt-1 text-sm text-slate-500">
              {connection?.connected
                ? `Connected${connection.label ? ` as ${connection.label}` : ""}${connection.last4 ? ` · token ends ${connection.last4}` : ""}.`
                : connection?.configured
                  ? "One click to connect: approve access in Google, and your locations, reviews and insights sync automatically."
                  : "Google connect isn't set up yet. Ask your platform admin to add the Google OAuth credentials (Platform → Google API Config)."}
            </p>
            {connection?.connectedAt && (
              <p className="mt-1 text-xs text-slate-400">
                Connected {new Date(connection.connectedAt).toLocaleString()}
                {connection.accountName ? ` · ${connection.accountName}` : ""}
                {connection.lastSyncedAt ? ` · last sync ${new Date(connection.lastSyncedAt).toLocaleString()}` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void connectGoogle()}
              disabled={busy === "connect" || !connection?.configured}
              className="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connection?.configured ? "Connect with Google" : "OAuth not configured"}
            </button>
            <button
              type="button"
              onClick={() => void syncGoogleLocations()}
              disabled={busy === "sync-all" || !connection?.connected}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "sync-all" ? "Syncing..." : "Import Google locations"}
            </button>
            {connection?.connected && (
              <button
                type="button"
                onClick={() => void disconnectGoogle()}
                disabled={busy === "disconnect"}
                className="rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
        {!connection?.connected && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setShowManualToken((v) => !v)}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              {showManualToken ? "Hide advanced setup" : "Advanced: connect with a refresh token instead"}
            </button>
            {showManualToken && (
              <form onSubmit={saveToken} className="mt-3 grid gap-3 lg:grid-cols-[1fr,220px,auto]">
                <input
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  required
                  type="password"
                  placeholder="Google refresh token"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="accounts/123 (optional)"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy === "token"}
                  className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Save token
                </button>
              </form>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <form onSubmit={create} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Add location</h2>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Google resource / Place ID
            <input value={placeId} onChange={(e) => setPlaceId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Category
            <input value={primaryCategory} onChange={(e) => setPrimaryCategory(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Address line
            <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            City
            <input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Add location</button>
        </form>

        <div className="space-y-3">
          {items.length === 0 && <p className="text-sm text-slate-500">No locations yet.</p>}
          {items.map((l) => (
            <div key={l.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-slate-800">{l.name}</span>
                  {l.primaryCategory && <span className="ml-2 text-xs text-slate-400">{l.primaryCategory}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[l.status]}`}>{l.status}</span>
                  <button
                    onClick={() => void syncOne(l)}
                    disabled={busy === l.id}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {busy === l.id ? "Syncing..." : l.hasCredential ? "Sync Google" : "Stamp sync"}
                  </button>
                  <button onClick={() => void remove(l.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {[l.address.line, l.address.city, l.address.region].filter(Boolean).join(", ") || "No address"}
                {l.rating != null && ` · ${l.rating}★ (${l.reviewCount})`}
                {l.hasCredential ? " · credential set" : ""}
                {l.lastSyncedAt ? ` · synced ${new Date(l.lastSyncedAt).toLocaleString()}` : ""}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{l.id}</code>
                <button onClick={() => copyId(l.id)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Copy ID</button>
              </div>
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <>
            <GmbVerificationPanel
              locations={items.map((l) => ({ id: l.id, name: l.name }))}
            />
            <GmbPlaceActionsPanel
              locations={items.map((l) => ({ id: l.id, name: l.name }))}
            />
          </>
        )}
      </div>
    </DashboardShell>
  );
}
