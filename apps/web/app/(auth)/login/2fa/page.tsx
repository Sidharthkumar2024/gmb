"use client";

// SSO second-factor challenge. After Google sign-in, a 2FA-enabled user is
// redirected here with a short-lived pending token in the URL fragment. They
// enter their TOTP / emailed code / recovery code; on success the API returns
// real session tokens which we persist, then continue to the dashboard.

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, tokenStore } from "../../../../src/lib/api";

export default function SsoTwoFactorPage() {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [method, setMethod] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const pt = params.get("pending");
    setMethod(params.get("method") || "");
    if (pt) {
      setPending(pt);
      // Scrub the pending token from the URL.
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      setErr("Your sign-in session expired. Please sign in again.");
    }
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/google/2fa-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken: pending, code: code.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.data?.accessToken) {
        throw new Error(json?.error?.message || "Invalid verification code.");
      }
      tokenStore.set(json.data);
      router.replace("/dashboard");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid verification code.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!pending) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await fetch(`${API_BASE}/api/v1/auth/google/2fa-resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken: pending }),
      });
      setNotice("A new code has been emailed.");
    } catch {
      setErr("Unable to resend code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Two-factor authentication</h1>
      <p className="mt-1 text-sm text-slate-500">
        {method === "EMAIL"
          ? "Enter the 6-digit code we emailed you to finish signing in."
          : "Enter the 6-digit code from your authenticator app to finish signing in."}
      </p>

      {err && (
        <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456 or a recovery code"
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <button
          type="submit"
          disabled={busy || !pending || code.trim().length < 6}
          className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? "Verifying..." : "Verify & continue"}
        </button>
      </form>

      <div className="mt-4 flex justify-between text-sm">
        {method === "EMAIL" ? (
          <button
            type="button"
            onClick={() => void resend()}
            disabled={busy}
            className="text-slate-600 hover:text-slate-900 disabled:opacity-60"
          >
            Resend code
          </button>
        ) : (
          <span />
        )}
        <a href="/login" className="text-slate-600 hover:text-slate-900">
          Back to sign in
        </a>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Lost your device? Enter one of your recovery codes above.
      </p>
    </>
  );
}
