"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { signup, ApiClientError } from "../../../src/lib/api";
import {
  billingIntentHref,
  type BillingIntent,
} from "../../../src/lib/billingIntent";
import { useI18n } from "../../../src/i18n/I18nProvider";

export function SignupForm({ billingIntent }: { billingIntent: BillingIntent }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const { message } = await signup({
        name: name.trim(),
        companyName: companyName.trim(),
        email: email.trim(),
        password,
        selectedPlanName:
          billingIntent.billing && billingIntent.plan
            ? billingIntent.plan
            : undefined,
      });
      setDone(message);
    } catch (err) {
      const msg =
        err instanceof ApiClientError ? err.message : t("auth.signup.failed");
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <h1 className="text-xl font-semibold">{t("auth.signup.checkEmailTitle")}</h1>
        <p className="mt-2 text-sm text-slate-600">{done}</p>
        <p className="mt-6 text-sm">
          <Link
            href={billingIntentHref("/login", billingIntent)}
            className="font-medium text-emerald-700 hover:underline"
          >
            {t("auth.signup.backToLogin")}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold">{t("auth.signup.title")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("auth.signup.subtitle")}</p>
      {billingIntent.billing && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {billingIntent.plan
            ? t("auth.signup.selectedPlanNamed", { plan: billingIntent.plan })
            : t("auth.signup.selectedPlan")}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="signup-name">
            {t("auth.signup.name")}
          </label>
          <input
            id="signup-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="signup-company">
            {t("auth.signup.company")}
          </label>
          <input
            id="signup-company"
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="signup-email">
            {t("auth.signup.email")}
          </label>
          <input
            id="signup-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="signup-password">
            {t("auth.common.password")}
          </label>
          <input
            id="signup-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p className="mt-1 text-xs text-slate-500">{t("auth.signup.passwordHint")}</p>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? t("auth.signup.submitting") : t("auth.login.createAccount")}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        {t("auth.signup.haveAccount")}{" "}
        <Link
          href={billingIntentHref("/login", billingIntent)}
          className="font-medium text-emerald-700 hover:underline"
        >
          {t("auth.login.title")}
        </Link>
      </p>
    </>
  );
}
