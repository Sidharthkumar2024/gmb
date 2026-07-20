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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div
          className={`mx-auto flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold text-white ${
            status === "done" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-slate-900"
          }`}
        >
          {status === "done" ? "✓" : status === "error" ? "!" : "G"}
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-950">Google Business Profile</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
        <Link
          href="/gmb-locations"
          className="mt-5 inline-flex rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
        >
          Back to locations
        </Link>
      </section>
    </main>
  );
}

export default function GmbConnectCallbackPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading...</div>}>
      <CallbackContent />
    </Suspense>
  );
}
