"use client";

// Persistent banner shown across every page when the active token has
// an `actorUserId` claim. The banner is the UI signal that the
// operator is operating *as* another user — and the only way out is
// the "Return to admin" button (or token expiry, which falls back to
// the parked admin refresh token).

import { useEffect, useState } from "react";
import { exitImpersonation, tokenStore } from "../lib/api";
import { decodeJwtPayload } from "../lib/jwtDecode";

interface BannerInfo {
  targetUserId: string;
  targetRole?: string;
  tenantId?: string;
  actorUserId: string;
  actorRole?: string;
}

function readBannerInfo(): BannerInfo | null {
  const token = tokenStore.getAccess();
  const payload = decodeJwtPayload(token);
  if (!payload?.actorUserId) return null;
  return {
    targetUserId: String(payload.userId ?? "unknown"),
    targetRole:
      typeof payload.role === "string" ? payload.role : undefined,
    tenantId:
      typeof payload.tenantId === "string" ? payload.tenantId : undefined,
    actorUserId: String(payload.actorUserId),
    actorRole:
      typeof payload.actorRole === "string" ? payload.actorRole : undefined,
  };
}

export function ImpersonationBanner() {
  const [info, setInfo] = useState<BannerInfo | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Read on mount; localStorage doesn't fire events for our own
    // writes, so we also poll on a long interval as a safety net.
    setInfo(readBannerInfo());
    const onStorage = () => setInfo(readBannerInfo());
    window.addEventListener("storage", onStorage);
    const interval = window.setInterval(() => setInfo(readBannerInfo()), 30_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, []);

  if (!info) return null;

  const handleExit = async () => {
    setExiting(true);
    try {
      await exitImpersonation();
    } finally {
      // Hard reload so every component re-reads the now-restored
      // admin token from localStorage. Simpler + safer than threading
      // state changes through useAuth + every fetched view.
      window.location.href = "/tenants";
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b-2 border-amber-500 bg-amber-100 px-4 py-2 text-sm text-amber-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
          <span aria-hidden>👁</span> Impersonating
        </span>
        <span>
          You are acting as <b>{info.targetUserId}</b>
          {info.targetRole ? ` (${info.targetRole})` : ""}
          {info.tenantId ? ` in tenant ${info.tenantId}` : ""}.
        </span>
        <span className="text-xs text-amber-800">
          All actions are audited under your admin account ({info.actorUserId}).
          Destructive mutations are blocked until you exit.
        </span>
      </div>
      <button
        onClick={() => void handleExit()}
        disabled={exiting}
        className="flex-shrink-0 rounded-md bg-amber-900 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-800 disabled:opacity-50"
      >
        {exiting ? "Exiting…" : "Return to admin"}
      </button>
    </div>
  );
}
