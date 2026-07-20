"use client";

// Language picker (Claude Final Complete Architecture §9). Lists the
// enabled languages by endonym and switches the active locale, which the
// I18nProvider persists and applies (incl. RTL) across the app.

import { useI18n } from "../i18n/I18nProvider";

export function LocaleSwitcher({
  className = "",
  onLocaleChange,
  disabled,
}: {
  className?: string;
  onLocaleChange?: (locale: string) => void;
  disabled?: boolean;
}) {
  const { locale, setLocale, languages, t } = useI18n();
  return (
    <select
      aria-label={t("common.language")}
      title={t("common.language")}
      data-testid="locale-switcher"
      value={locale}
      disabled={disabled || languages.length < 2}
      onChange={(e) => {
        const next = setLocale(e.target.value);
        onLocaleChange?.(next);
      }}
      className={`rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {languages.map((l) => (
        <option key={l.code} value={l.code}>
          {l.nativeName}
        </option>
      ))}
    </select>
  );
}
