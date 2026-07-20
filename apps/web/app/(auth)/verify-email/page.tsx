"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyEmail, ApiClientError } from "../../../src/lib/api";
import { useI18n } from "../../../src/i18n/I18nProvider";

function VerifyEmailInner() {
  const { t } = useI18n();
  const params = useSearchParams();
  const token = params?.get("token");
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  // Only the API's own error string is stored raw; all other copy is
  // resolved through t() at render time so it tracks the active locale.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setErrorDetail(null);
      return;
    }
    verifyEmail(token)
      .then(() => setState("ok"))
      .catch((err) => {
        setState("error");
        setErrorDetail(err instanceof ApiClientError ? err.message : null);
      });
  }, [token]);

  const message =
    state === "working"
      ? t("auth.verify.working")
      : state === "ok"
        ? t("auth.verify.success")
        : errorDetail ??
          (token ? t("auth.verify.failed") : t("auth.verify.missingToken"));

  return (
    <>
      <h1 className="text-xl font-semibold">{t("auth.verify.title")}</h1>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      {state === "ok" && (
        <Link
          href="/login"
          className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {t("auth.verify.continueLogin")}
        </Link>
      )}
      {state === "error" && (
        <Link
          href="/signup"
          className="mt-6 inline-block text-sm font-medium text-emerald-700 hover:underline"
        >
          {t("auth.verify.backToSignup")}
        </Link>
      )}
    </>
  );
}

function VerifyEmailFallback() {
  const { t } = useI18n();
  return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailInner />
    </Suspense>
  );
}
