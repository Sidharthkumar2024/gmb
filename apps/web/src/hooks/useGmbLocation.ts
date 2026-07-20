"use client";

import { useCallback, useSyncExternalStore } from "react";

// Shared "currently selected GMB location" that persists across every GMB
// sub-page (posts, reputation, ranking, citations, insights…). The GMB pages
// live at flat top-level routes with no common layout, so a React context
// wouldn't survive navigation. This is a module-level store backed by
// localStorage: every useGmbLocation() caller in the document subscribes to the
// same value (so the header switcher and the page update together), and the
// value survives navigation + syncs across tabs. Drop-in compatible with
// useState<string>("").

const STORAGE_KEY = "gmb.selectedLocationId";

// Hydrated from localStorage at module load on the client; "" during SSR.
let current: string =
  typeof window !== "undefined"
    ? (() => {
        try {
          return window.localStorage.getItem(STORAGE_KEY) ?? "";
        } catch {
          return "";
        }
      })()
    : "";

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Cross-tab sync: the `storage` event fires in OTHER tabs when one changes it.
  function onStorage(e: StorageEvent) {
    if (e.key === STORAGE_KEY) {
      current = e.newValue ?? "";
      emit();
    }
  }
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function setSelected(id: string) {
  if (id === current) return;
  current = id;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private-mode / storage disabled — selection just won't persist.
  }
  emit();
}

export function useGmbLocation(): [string, (id: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => current,
    () => "", // server snapshot — avoids a hydration mismatch
  );
  const update = useCallback((id: string) => setSelected(id), []);
  return [value, update];
}
