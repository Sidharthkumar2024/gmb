"use client";

import type { CurrencyOption } from "../lib/api";

export function CurrencySwitcher({
  value,
  currencies,
  className = "",
  onCurrencyChange,
  disabled,
}: {
  value: string;
  currencies: CurrencyOption[];
  className?: string;
  onCurrencyChange?: (currencyCode: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Currency"
      title="Currency"
      data-testid="currency-switcher"
      value={value}
      disabled={disabled || currencies.length < 2}
      onChange={(e) => onCurrencyChange?.(e.target.value)}
      className={`h-9 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {currencies.length === 0 ? (
        <option value={value}>{value}</option>
      ) : (
        currencies.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.code} · {currency.symbol}
          </option>
        ))
      )}
    </select>
  );
}
