"use client";

import { useEffect, useRef, useState } from "react";

const NS = "nx_autosave";

interface Options {
  /** Debounce window (ms) before writing to localStorage. Default 400ms. */
  debounceMs?: number;
  /** Discard entries older than this. Default 7 days. */
  ttlMs?: number;
  /**
   * Skip writes when this returns true (e.g. when value is empty). Lets us
   * delete the key on clear instead of storing empty strings everywhere.
   */
  isEmpty?: (value: unknown) => boolean;
}

interface Envelope<T> {
  v: T;
  savedAt: number;
}

function storageKey(key: string): string {
  return `${NS}:${key}`;
}

function read<T>(key: string, ttlMs: number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (Date.now() - env.savedAt > ttlMs) {
      window.localStorage.removeItem(storageKey(key));
      return null;
    }
    return env.v;
  } catch {
    return null;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(key),
      JSON.stringify({ v: value, savedAt: Date.now() } satisfies Envelope<T>),
    );
  } catch {
    // localStorage full or blocked — silently drop
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}

/**
 * A `useState` that transparently persists its value to localStorage with
 * debouncing. Returns `[value, setValue, status, clear]`.
 *
 * - `value` mirrors the latest user input.
 * - `setValue` accepts a value or updater function (just like useState).
 * - `status` is "idle" | "saving" | "saved" — useful for a "Saved" pill.
 * - `clear()` removes the entry from storage and resets to the initial value.
 *
 * `key` should be tenant/scope-prefixed by the caller, e.g.
 * `inbox:reply:${tenantId}:${conversationId}`.
 */
export function useAutoSave<T>(
  key: string,
  initial: T,
  opts: Options = {},
): [T, (next: T | ((prev: T) => T)) => void, "idle" | "saving" | "saved", () => void] {
  const ttlMs = opts.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
  const debounceMs = opts.debounceMs ?? 400;
  const isEmpty = opts.isEmpty ?? ((v: unknown) => v === "" || v === undefined || v === null);

  const [value, setValueState] = useState<T>(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const hydratedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from localStorage once (after mount, to avoid SSR mismatch).
  useEffect(() => {
    const stored = read<T>(key, ttlMs);
    if (stored !== null) {
      setValueState(stored);
      setStatus("saved");
    }
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function setValue(next: T | ((prev: T) => T)) {
    setValueState((prev) => {
      const computed =
        typeof next === "function" ? (next as (p: T) => T)(prev) : next;

      if (hydratedRef.current) {
        setStatus("saving");
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          if (isEmpty(computed)) {
            remove(key);
          } else {
            write(key, computed);
          }
          setStatus("saved");
        }, debounceMs);
      }

      return computed;
    });
  }

  function clear() {
    if (timerRef.current) clearTimeout(timerRef.current);
    remove(key);
    setStatus("idle");
    setValueState(initial);
  }

  return [value, setValue, status, clear];
}

/** Stable utility for callers that need to wipe arbitrary keys (e.g. on logout). */
export function clearAllAutoSave(): void {
  if (typeof window === "undefined") return;
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(`${NS}:`)) toDelete.push(k);
    }
    for (const k of toDelete) window.localStorage.removeItem(k);
  } catch {
    // ignore
  }
}
