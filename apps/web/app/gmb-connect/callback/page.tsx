"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiClientError } from "../../../src/lib/api";
import { useAuth } from "../../../src/hooks/useAuth";

function CallbackContent() {
  const params = useSearchParams();
  const { loading, user } = useAuth({ required: true });
  const [status, setStatus] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("Connecting Google Business Profile...");

  useEffect(() => {
    if (loading || !user || !params) return;
    const code = params.get("code");
    const state = params.get("state") ?? undefined;
    const error = params.get("error");
    if (error) {
      setStatus("error");
      setMessage(`Google rejected the connection: ${error}`);
      return;
    }
    if (!code) {
      setStatus("error");
      setMessage("Google did not return an authorization code.");
      return;
    }
    const redirectUri = `${window.location.origin}/gmb-connect/callback`;
    api
      .post("/api/v1/gmb/google/oauth/exchange", { code, state, redirectUri })
      .then(() => {
        setStatus("done");
        setMessage("Google Business Profile connected. You can now import locations.");
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof ApiClientError ? err.message : "Unable to finish Google connection.");
      });
  }, [loading, user, params]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gmb-canvas p-6 font-geist">
      <section className="w-full max-w-md rounded-panel border border-gmb-line bg-gmb-surface p-6 text-center shadow-sm">
        <div
          className={`mx-auto flex h-10 w-10 items-center justify-center rounded-control text-sm font-bold text-white ${
            status === "done" ? "bg-gmb-ok" : status === "error" ? "bg-gmb-danger" : "bg-gmb-night"
          }`}
        >
          {status === "done" ? "✓" : status === "error" ? "!" : "G"}
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-[-0.01em] text-gmb-ink">
          Google Business Profile
        </h1>
        <p className="mt-2 text-sm2 leading-6 text-gmb-ink-muted">{message}</p>
        <Link
          href={status === "done" ? "/gmb-locations" : "/gmb-connect"}
          className="mt-5 inline-flex rounded-control bg-gmb-night px-4 py-2 text-sm2 font-semibold text-white no-underline hover:bg-gmb-night-soft hover:no-underline"
        >
          {status === "done" ? "Import locations" : "Back to connect"}
        </Link>
      </section>
    </main>
  );
}

export default function GmbConnectCallbackPage() {
  return (
    <Suspense fallback={<div className="p-8 font-geist text-sm2 text-gmb-ink-subtle">Loading…</div>}>
      <CallbackContent />
    </Suspense>
  );
}
