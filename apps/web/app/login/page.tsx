"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthLayout, Field, SubmitButton, AuthError } from "../../src/components/gmb/AuthLayout";
import { login } from "../../src/lib/api";
import { ApiClientError } from "../../src/lib/api";
import { roleHome } from "../../src/hooks/useAuth";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email.trim(), password);
      // Route by role: platform staff land on /admin, everyone else on the
      // GMB dashboard. Hardcoding the dashboard here once sent SUPER_ADMIN to
      // the wrong home.
      router.push(roleHome(result.user.role));
    } catch (err) {
      // The API returns one message for unknown-email and wrong-password
      // alike; surface it as-is rather than guessing which it was, so the UI
      // does not leak whether an account exists.
      setError(
        err instanceof ApiClientError ? err.message : "Could not sign in. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your GMB Suite workspace — your Adgrowly account works here too."
      footer={
        <div className="mt-6 text-sm2 text-gmb-ink-muted">
          New to GMB Suite?{" "}
          <Link href="/signup" className="font-semibold text-gmb-brand">
            Create an account
          </Link>
        </div>
      }
    >
      {error && <AuthError>{error}</AuthError>}
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <Field
          label="Email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@business.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          right={
            <Link href="/forgot-password" className="text-[11px] text-gmb-brand">
              Forgot?
            </Link>
          }
        />
        <SubmitButton disabled={busy || !email.trim() || !password}>
          {busy ? "Signing in…" : "Log in"}
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
