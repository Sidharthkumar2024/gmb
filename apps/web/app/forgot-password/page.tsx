"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthLayout, Field, SubmitButton, AuthError } from "../../src/components/gmb/AuthLayout";
import { api, ApiClientError } from "../../src/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/request-password-reset", { email: email.trim() }, { auth: false });
      // The API answers identically whether or not the address exists, and so
      // must this screen — a different message here would undo that and let
      // anyone test which emails are registered.
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Could not send the reset link.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle=""
        footer={
          <div className="mt-3.5 text-xs text-gmb-ink-subtle">
            Didn&rsquo;t get it?{" "}
            <button
              type="button"
              onClick={() => setSent(false)}
              className="font-semibold text-gmb-brand"
            >
              Try again
            </button>
          </div>
        }
      >
        <div className="mt-5 flex h-12 w-12 items-center justify-center rounded-[13px] bg-gmb-ok-bg text-[22px] text-gmb-ok">
          ✓
        </div>
        <p className="mt-3.5 text-[13px] leading-relaxed text-gmb-ink-muted">
          If <strong className="text-gmb-ink">{email}</strong> has an account, a password reset
          link is on its way. The link expires in 60 minutes.
        </p>
        <Link href="/login" className="mt-5 block no-underline hover:no-underline">
          <span className="block rounded-[10px] bg-gmb-brand px-3 py-3 text-center text-[13.5px] font-semibold text-white">
            Back to log in
          </span>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send a secure reset link."
      footer={
        <div className="mt-[18px] text-sm2 text-gmb-ink-muted">
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-gmb-brand">
            Log in
          </Link>
        </div>
      }
    >
      {error && <AuthError>{error}</AuthError>}
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <Field
          label="Work email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@business.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <SubmitButton disabled={busy || !email.trim()}>
          {busy ? "Sending…" : "Send reset link"}
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
