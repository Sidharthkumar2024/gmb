"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthLayout, Field, SubmitButton, AuthError } from "../../src/components/gmb/AuthLayout";
import { api, ApiClientError, login } from "../../src/lib/api";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  // The landing page's "scan my business" box hands the name over here so the
  // visitor does not retype it.
  const [companyName, setCompanyName] = useState(params.get("business") ?? "");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(
        "/api/v1/auth/signup",
        {
          companyName: companyName.trim(),
          email: email.trim(),
          password,
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(category.trim() ? { category: category.trim() } : {}),
        },
        { auth: false },
      );
      // Sign in immediately so the first run lands in the workspace rather
      // than on a "now go log in" dead end.
      await login(email.trim(), password);
      router.push("/gmb-dashboard");
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Could not create your account.",
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="14-day free trial on Grow · no credit card · cancel anytime."
      footer={
        <>
          <p className="mt-3.5 text-[11px] leading-relaxed text-gmb-ink-subtle">
            By continuing you agree to the{" "}
            <Link href="/terms" className="text-gmb-brand">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-gmb-brand">
              Privacy policy
            </Link>
            .
          </p>
          <div className="mt-3.5 text-sm2 text-gmb-ink-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-gmb-brand">
              Log in
            </Link>
          </div>
        </>
      }
    >
      {error && <AuthError>{error}</AuthError>}
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <Field
          label="Business name"
          required
          placeholder="Maple Dental Studio"
          hint="Exactly as it appears on your Google profile — we'll match it when you connect."
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="City"
            placeholder="Toronto"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <Field
            label="Category"
            placeholder="Dentist"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        <Field
          label="Work email"
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
          minLength={8}
          autoComplete="new-password"
          placeholder="8+ characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <SubmitButton
          disabled={busy || !companyName.trim() || !email.trim() || password.length < 8}
        >
          {busy ? "Creating your workspace…" : "Create account"}
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
