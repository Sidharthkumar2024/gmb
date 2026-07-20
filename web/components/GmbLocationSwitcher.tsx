"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useGmbLocation } from "../hooks/useGmbLocation";

// Header dropdown for picking the active GMB location. Backed by the shared
// useGmbLocation hook so the choice persists across every GMB page. Auto-selects
// the first location when nothing is stored yet, so multi-location tenants land
// on a sensible default instead of an empty selector.

interface LocationLite {
  id: string;
  name: string;
  status: "DRAFT" | "CONNECTED" | "SUSPENDED";
}

export function GmbLocationSwitcher({ className = "" }: { className?: string }) {
  const [selectedLocationId, setSelectedLocationId] = useGmbLocation();
  const [locations, setLocations] = useState<LocationLite[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<LocationLite[]>("/api/v1/gmb/locations")
      .then((rows) => {
        if (cancelled) return;
        setLocations(rows);
        // Read the persisted selection LIVE here rather than from the hook's
        // render value — during hydration useSyncExternalStore briefly reports
        // "", and this effect's closure would otherwise capture that stale empty
        // value and clobber a real stored choice. Default to the first location
        // only when nothing valid is stored (first run, or a deleted location).
        let stored = "";
        try {
          stored = window.localStorage.getItem("gmb.selectedLocationId") ?? "";
        } catch {
          stored = "";
        }
        const stillValid = rows.some((r) => r.id === stored);
        if (rows.length > 0 && (!stored || !stillValid)) {
          setSelectedLocationId(rows[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      });
    return () => {
      cancelled = true;
    };
    // Run once on mount; selection changes are driven by the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (locations.length === 0) return null;

  return (
    <label className={`flex items-center gap-2 text-sm ${className}`}>
      <span className="text-slate-500">Location</span>
      <select
        value={selectedLocationId}
        onChange={(e) => setSelectedLocationId(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
            {l.status !== "CONNECTED" ? ` (${l.status.toLowerCase()})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
