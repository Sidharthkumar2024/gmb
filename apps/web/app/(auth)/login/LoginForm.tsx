"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, resendVerification, ApiClientError, API_BASE } from "../../../src/lib/api";
import { roleHome } from "../../../src/hooks/useAuth";
import { useI18n } from "../../../src/i18n/I18nProvider";
import {
  billingDestinationForRole,
  billingIntentHref,
  type BillingIntent,
} from "../../../src/lib/billingIntent";

interface LoginError {
  message: string;
  hint?: string;
  canResendVerification?: boolean;
}

function explainLoginError(err: unknown): LoginError {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case "INVALID_CREDENTIALS":
        return { message: "Email or password is incorrect." };
      case "TOO_MANY_REQUESTS":
        return {
          message: err.message,
          hint:
            "Too many failed attempts on this account. Wait the cooldown out or reset your password.",
        };
      case "EMAIL_NOT_VERIFIED":
        return {
          message: "Please verify your email before logging in.",
          hint: "Check your inbox for the verification link, or send a fresh one below.",
          canResendVerification: true,
        };
      case "FORBIDDEN":
        return { message: err.message };
      default:
        return { message: err.message };
    }
  }
  return {
    message: "Can't reach the server.",
    hint: "Check your connection, or confirm the API is running on the expected port.",
  };
}

const GOOGLE_LOGIN_ERRORS: Record<string, string> = {
  google_disabled: "Google sign-in isn't enabled for this workspace.",
  google_denied: "Google sign-in was cancelled.",
  google_state: "Google sign-in expired. Please try again.",
  google_unverified: "Your Google email address isn't verified.",
  google_domain: "Your Google account's domain isn't allowed here.",
  google_no_account: "No account matches that Google email. Ask an admin to invite you first.",
  account_suspended: "This account is suspended. Contact support.",
};

export function LoginForm({ billingIntent }: { billingIntent: BillingIntent }) {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<LoginError | null>(null);
  const [resendDone, setResendDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`${API_BASE}/api/v1/auth/google/enabled`)
      .then((r) => r.json())
      .then((j) => setGoogleEnabled(Boolean(j?.data?.enabled)))
      .catch(() => undefined);
    const code = new URLSearchParams(window.location.search).get("error");
    if (code && GOOGLE_LOGIN_ERRORS[code]) setGoogleError(GOOGLE_LOGIN_ERRORS[code]);
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResendDone(null);
    setBusy(true);
    try {
      const { user } = await login(email.trim(), password);
      router.push(
        billingDestinationForRole(user.role, billingIntent, roleHome(user.role)),
      );
    } catch (err) {
      setError(explainLoginError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onResendVerification() {
    setError(null);
    setResendDone(null);
    setResendBusy(true);
    try {
      const { message } = await resendVerification(email.trim());
      setResendDone(message);
    } catch (err) {
      setError(explainLoginError(err));
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">{t("auth.login.title")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("auth.login.subtitle")}</p>
      {billingIntent.billing && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {billingIntent.plan
            ? t("auth.login.continueWithPlan", { plan: billingIntent.plan })
            : t("auth.login.continueAfter")}
        </div>
      )}

      {googleError && (
        <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {googleError}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="email">
            {t("auth.common.email")}
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="password">
            {t("auth.common.password")}
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <div className="font-medium">{error.message}</div>
            {error.hint && (
              <div className="mt-1 text-xs text-red-600/80">{error.hint}</div>
            )}
            {error.canResendVerification && (
              <button
                type="button"
                onClick={onResendVerification}
                disabled={resendBusy || !email.trim()}
                className="mt-3 block font-medium text-red-800 underline disabled:opacity-60"
              >
                {resendBusy ? t("auth.login.resending") : t("auth.login.resend")}
              </button>
            )}
          </div>
        )}

        {resendDone && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {resendDone}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? t("auth.login.submitting") : t("auth.login.submit")}
        </button>
      </form>

      {googleEnabled && (
        <>
          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            or
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <a
            href={`${API_BASE}/api/v1/auth/google/start`}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
            </svg>
            Sign in with Google
          </a>
        </>
      )}

      <div className="mt-6 flex justify-between text-sm">
        <Link href="/reset-password" className="text-slate-600 hover:text-slate-900">
          {t("auth.login.forgotPassword")}
        </Link>
        <Link
          href={billingIntentHref("/signup", billingIntent)}
          className="text-slate-600 hover:text-slate-900"
        >
          {t("auth.login.createAccount")}
        </Link>
      </div>
    </>
  );
}
