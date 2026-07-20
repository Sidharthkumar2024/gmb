"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  requestPasswordReset,
  resetPassword,
  ApiClientError,
} from "../../../src/lib/api";
import { useI18n } from "../../../src/i18n/I18nProvider";

function ResetPasswordInner() {
  const { t } = useI18n();
  const params = useSearchParams();
  const token = params?.get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setInfo(t("auth.reset.requestSent"));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("auth.reset.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      await resetPassword(token, password);
      setInfo(t("auth.reset.updated"));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("auth.reset.resetFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">
        {token ? t("auth.reset.setTitle") : t("auth.reset.requestTitle")}
      </h1>

      {info && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {info}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!token ? (
        <form onSubmit={onRequest} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              {t("auth.common.email")}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy ? t("auth.login.resending") : t("auth.reset.sendLink")}
          </button>
        </form>
      ) : (
        <form onSubmit={onReset} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              {t("auth.reset.newPassword")}
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy ? t("auth.reset.updating") : t("auth.reset.updateBtn")}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-slate-600">
        <Link href="/login" className="font-medium text-emerald-700 hover:underline">
          {t("auth.signup.backToLogin")}
        </Link>
      </p>
    </>
  );
}

function ResetPasswordFallback() {
  const { t } = useI18n();
  return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
