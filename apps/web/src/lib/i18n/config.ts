// ============================================================================
// Multi-language config (Claude Final Complete Architecture §9)
//
// The 13 launch languages with locale code, English + native label, and
// text direction. Urdu + Arabic are RTL. Pure + dependency-free so it can
// be unit-tested and imported by both the provider and (later) the
// SuperAdmin language admin. SuperAdmin enable/disable is layered on top
// via the DB Language table in a later slice; `enabled` here is the
// build-time default.
// ============================================================================

export type Direction = "ltr" | "rtl";

export interface LanguageDef {
  /** BCP-47 / ISO-639 locale code used as the dictionary key. */
  code: string;
  /** English name shown in admin. */
  label: string;
  /** Endonym shown to the user in the switcher. */
  nativeName: string;
  dir: Direction;
  /** Default enabled state (SuperAdmin can override via DB later). */
  enabled: boolean;
}

export const LANGUAGES: readonly LanguageDef[] = [
  { code: "en", label: "English", nativeName: "English", dir: "ltr", enabled: true },
  { code: "hi", label: "Hindi", nativeName: "हिन्दी", dir: "ltr", enabled: true },
  { code: "ur", label: "Urdu", nativeName: "اردو", dir: "rtl", enabled: true },
  { code: "bn", label: "Bengali", nativeName: "বাংলা", dir: "ltr", enabled: true },
  { code: "ar", label: "Arabic", nativeName: "العربية", dir: "rtl", enabled: true },
  { code: "fr", label: "French", nativeName: "Français", dir: "ltr", enabled: true },
  { code: "es", label: "Spanish", nativeName: "Español", dir: "ltr", enabled: true },
  { code: "de", label: "German", nativeName: "Deutsch", dir: "ltr", enabled: true },
  { code: "pa", label: "Punjabi", nativeName: "ਪੰਜਾਬੀ", dir: "ltr", enabled: true },
  { code: "ta", label: "Tamil", nativeName: "தமிழ்", dir: "ltr", enabled: true },
  { code: "te", label: "Telugu", nativeName: "తెలుగు", dir: "ltr", enabled: true },
  { code: "mr", label: "Marathi", nativeName: "मराठी", dir: "ltr", enabled: true },
  { code: "gu", label: "Gujarati", nativeName: "ગુજરાતી", dir: "ltr", enabled: true },
] as const;

export const DEFAULT_LOCALE = "en";

const BY_CODE: Record<string, LanguageDef> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l]),
);

/** Look up a language by code; undefined when unknown. */
export function getLanguage(code: string | null | undefined): LanguageDef | undefined {
  if (!code) return undefined;
  return BY_CODE[code.toLowerCase()];
}

/** Text direction for a locale; falls back to ltr for unknown codes. */
export function directionOf(code: string | null | undefined): Direction {
  return getLanguage(code)?.dir ?? "ltr";
}

export function isRtl(code: string | null | undefined): boolean {
  return directionOf(code) === "rtl";
}

/**
 * Resolve an arbitrary input (saved pref, navigator.language, header) to a
 * supported, enabled locale — exact match first, then the base language
 * subtag (e.g. "en-US" → "en"), else the default. Pure for testing.
 */
export function resolveLocale(
  input: string | null | undefined,
  enabledCodes?: ReadonlySet<string>,
): string {
  const isUsable = (code: string) =>
    Boolean(BY_CODE[code]) && (!enabledCodes || enabledCodes.has(code));

  if (input) {
    const lower = input.toLowerCase();
    if (isUsable(lower)) return lower;
    const base = lower.split("-")[0];
    if (isUsable(base)) return base;
  }
  return DEFAULT_LOCALE;
}
