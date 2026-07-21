"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthLayout, Field, SubmitButton, AuthError } from "../../src/components/gmb/AuthLayout";
import { api, ApiClientError } from "../../src/lib/api";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/reset-password", { token, password }, { auth: false });
      // The API revokes every session on reset, so there is no stale token to
      // clear — send the user to sign in fresh.
      router.push("/login?reset=1");
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Could not reset your password.",
      );
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        title="Link not valid"
        subtitle="This reset link is missing its token. Request a new one and try again."
      >
        <Link href="/forgot-password" className="mt-5 block no-underline hover:no-underline">
          <span className="block rounded-[10px] bg-gmb-brand px-3 py-3 text-center text-[13.5px] font-semibold text-white">
            Request a new link
          </span>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="For your security, this signs you out everywhere else."
      footer={
        <div className="mt-[18px] text-sm2 text-gmb-ink-muted">
          <Link href="/login" className="font-semibold text-gmb-brand">
            Back to log in
          </Link>
        </div>
      }
    >
      {error && <AuthError>{error}</AuthError>}
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <Field
          label="New password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="8+ characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="Confirm password"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Repeat it"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          hint={mismatch ? "Passwords don't match." : undefined}
        />
        <SubmitButton disabled={busy || password.length < 8 || mismatch || !confirm}>
          {busy ? "Updating…" : "Update password"}
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
