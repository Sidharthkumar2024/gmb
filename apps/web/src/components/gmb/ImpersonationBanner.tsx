"use client";

import { useEffect, useState } from "react";
import { tokenStore } from "../../lib/api";
import { isImpersonating } from "../../lib/jwtDecode";

// A floating pill shown whenever the current session is an admin impersonating a
// workspace (the access token carries an `actorUserId` claim). Exiting restores
// the parked admin tokens and returns to the admin console. Rendered fixed, so
// it never disturbs the surrounding layout.

export function ImpersonationBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(isImpersonating(tokenStore.getAccess()));
  }, []);

  if (!active) return null;

  const exit = () => {
    tokenStore.restoreAdminFromStash();
    // Hard-nav so the app re-initialises as the admin again.
    window.location.href = "/admin/accounts";
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-gmb-warn/40 bg-gmb-warn/15 px-4 py-2 shadow-lg backdrop-blur">
        <span className="h-2 w-2 flex-shrink-0 rounded-full bg-gmb-warn" />
        <span className="text-xs2 font-medium text-gmb-ink">
          You&apos;re viewing this workspace as an admin
        </span>
        <button
          type="button"
          onClick={exit}
          className="rounded-full bg-gmb-ink px-3 py-1 text-xs2 font-semibold text-gmb-canvas hover:opacity-90"
        >
          Exit
        </button>
      </div>
    </div>
  );
}
