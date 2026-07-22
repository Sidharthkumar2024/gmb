"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Pill, Button, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";
import { useAuth } from "../../src/hooks/useAuth";

// Settings — workspace preferences, Google connection status, account.
//
// Language and currency write through the real workspace endpoints; the values
// shown are the tenant's saved preference (or the platform default when none is
// set). The Google connection panel reports the true state — configured vs
// connected are distinct, because the platform can have OAuth credentials while
// this workspace has not linked an account.

interface LanguageSettings {
  setting: { languageCode: string; canUpdatePreference: boolean };
  policy: { allowedLanguages: string[] };
}
interface CurrencySettings {
  setting: { currencyCode: string; symbol: string; canUpdatePreference: boolean };
  policy: { allowedCurrencies: string[] };
}
interface Connection {
  configured: boolean;
  connected: boolean;
  label: string | null;
  last4: string | null;
  scopes: string[];
  connectedAt: string | null;
}
interface Me {
  user: { email: string; name: string; role: string };
  tenant: { name: string; industry: string | null; timezone: string } | null;
}

const LANG_LABEL: Record<string, string> = {
  en: "English", hi: "हिन्दी", mr: "मराठी", ta: "தமிழ்", te: "తెలుగు", gu: "ગુજરાતી", bn: "বাংলা",
};

export default function GmbSettingsPage() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [lang, setLang] = useState<LanguageSettings | null>(null);
  const [currency, setCurrency] = useState<CurrencySettings | null>(null);
  const [conn, setConn] = useState<Connection | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [l, c, cn, m] = await Promise.all([
          api.get<LanguageSettings>("/api/v1/language-settings"),
          api.get<CurrencySettings>("/api/v1/currency-settings"),
          api.get<Connection>("/api/v1/gmb/google/connection").catch(() => null),
          api.get<Me>("/api/v1/auth/me").catch(() => null),
        ]);
        if (cancelled) return;
        setLang(l);
        setCurrency(c);
        setConn(cn);
        setMe(m);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiClientError ? e.message : "Could not load settings.");
      }
    }
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  function flashSaved(what: string) {
    setSaved(what);
    setTimeout(() => setSaved((s) => (s === what ? null : s)), 2000);
  }

  async function updateLanguage(languageCode: string) {
    setBusy("lang");
    setError(null);
    try {
      setLang(await api.patch<LanguageSettings>("/api/v1/language-settings", { languageCode }));
      flashSaved("Language saved");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update language.");
    } finally {
      setBusy(null);
    }
  }

  async function updateCurrency(currencyCode: string) {
    setBusy("currency");
    setError(null);
    try {
      setCurrency(await api.patch<CurrencySettings>("/api/v1/currency-settings", { currencyCode }));
      flashSaved("Currency saved");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not update currency.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <GmbShell title="Settings">
      {error && <ErrorNote>{error}</ErrorNote>}
      {saved && (
        <div className="mb-3.5 rounded-control border border-gmb-ok/30 bg-gmb-ok-bg px-3 py-2 text-sm2 text-gmb-ok">
          {saved}
        </div>
      )}

      <div className="grid gap-3.5 lg:grid-cols-2 lg:items-start">
        {/* Google connection */}
        <Card>
          <SectionLabel>Google Business Profile</SectionLabel>
          {conn === null ? (
            <Skeleton className="mt-3 h-16" />
          ) : conn.connected ? (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <Pill tone="ok">Connected</Pill>
                {conn.label && <span className="text-sm2 font-medium">{conn.label}</span>}
                {conn.last4 && (
                  <span className="font-geist-mono text-micro text-gmb-ink-subtle">
                    ••••{conn.last4}
                  </span>
                )}
              </div>
              {conn.connectedAt && (
                <div className="mt-1.5 font-geist-mono text-micro text-gmb-ink-subtle">
                  since {new Date(conn.connectedAt).toLocaleDateString()}
                </div>
              )}
              <Link href="/gmb-connect" className="mt-3 inline-block no-underline hover:no-underline">
                <span className="inline-block rounded-control border border-gmb-line bg-gmb-surface px-4 py-2 text-sm2 font-semibold text-gmb-ink">
                  Manage connection
                </span>
              </Link>
            </div>
          ) : (
            <div className="mt-3">
              <Pill tone="warn">Not connected</Pill>
              <div className="mt-2 text-sm2 text-gmb-ink-muted">
                {conn.configured
                  ? "Connect your Google account to sync reviews, Q&A, posts and insights."
                  : "Google sign-in isn't set up on this platform yet. Ask your admin to add the OAuth credentials."}
              </div>
              {conn.configured && (
                <Link href="/gmb-connect" className="mt-3 inline-block no-underline hover:no-underline">
                  <span className="inline-block rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white">
                    Connect Google
                  </span>
                </Link>
              )}
            </div>
          )}
        </Card>

        {/* Workspace */}
        <Card>
          <SectionLabel>Workspace</SectionLabel>
          {me === null ? (
            <Skeleton className="mt-3 h-16" />
          ) : (
            <dl className="mt-3 flex flex-col gap-2 text-sm2">
              {(
                [
                  ["Name", me.tenant?.name],
                  ["Industry", me.tenant?.industry],
                  ["Timezone", me.tenant?.timezone],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-gmb-ink-subtle">{k}</dt>
                  <dd className="truncate font-medium text-gmb-ink">{v || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>

        {/* Language */}
        <Card>
          <SectionLabel>Language</SectionLabel>
          {lang === null ? (
            <Skeleton className="mt-3 h-10" />
          ) : (
            <select
              value={lang.setting.languageCode}
              disabled={!lang.setting.canUpdatePreference || busy === "lang"}
              onChange={(e) => void updateLanguage(e.target.value)}
              className="mt-3 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 outline-none disabled:opacity-60"
            >
              {lang.policy.allowedLanguages.map((code) => (
                <option key={code} value={code}>
                  {LANG_LABEL[code] ?? code}
                </option>
              ))}
            </select>
          )}
        </Card>

        {/* Currency */}
        <Card>
          <SectionLabel>Currency</SectionLabel>
          {currency === null ? (
            <Skeleton className="mt-3 h-10" />
          ) : (
            <select
              value={currency.setting.currencyCode}
              disabled={!currency.setting.canUpdatePreference || busy === "currency"}
              onChange={(e) => void updateCurrency(e.target.value)}
              className="mt-3 w-full rounded-control border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 outline-none disabled:opacity-60"
            >
              {currency.policy.allowedCurrencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          )}
        </Card>

        {/* Account */}
        <Card>
          <SectionLabel>Account</SectionLabel>
          {me === null ? (
            <Skeleton className="mt-3 h-16" />
          ) : (
            <div className="mt-3">
              <div className="text-sm2 font-medium text-gmb-ink">{me.user.name || me.user.email}</div>
              <div className="font-geist-mono text-micro text-gmb-ink-subtle">
                {me.user.email} · {me.user.role}
              </div>
              <div className="mt-3 flex gap-1.5">
                <Link href="/forgot-password" className="no-underline hover:no-underline">
                  <span className="inline-block rounded-control border border-gmb-line bg-gmb-surface px-4 py-2 text-sm2 font-semibold text-gmb-ink">
                    Change password
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void signOut();
                    router.push("/login");
                  }}
                >
                  Sign out
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Billing pointer */}
        <Card>
          <SectionLabel>Billing &amp; credits</SectionLabel>
          <div className="mt-3 text-sm2 text-gmb-ink-muted">
            AI features spend credits. Review your balance and usage on the billing page.
          </div>
          <Link href="/gmb-billing" className="mt-3 inline-block no-underline hover:no-underline">
            <span className="inline-block rounded-control border border-gmb-line bg-gmb-surface px-4 py-2 text-sm2 font-semibold text-gmb-ink">
              View billing
            </span>
          </Link>
        </Card>
      </div>
    </GmbShell>
  );
}
