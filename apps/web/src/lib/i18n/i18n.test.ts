import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LANGUAGES,
  directionOf,
  getLanguage,
  isRtl,
  resolveLocale,
} from "./config";
import { translate } from "./translate";
import { dictFor, MESSAGES } from "./messages";

describe("language config", () => {
  it("ships the 13 PDF §9 launch languages", () => {
    expect(LANGUAGES).toHaveLength(13);
    const codes = LANGUAGES.map((l) => l.code);
    for (const c of ["en", "hi", "ur", "bn", "ar", "fr", "es", "de", "pa", "ta", "te", "mr", "gu"]) {
      expect(codes).toContain(c);
    }
  });

  it("marks only Urdu and Arabic as RTL", () => {
    const rtl = LANGUAGES.filter((l) => l.dir === "rtl").map((l) => l.code).sort();
    expect(rtl).toEqual(["ar", "ur"]);
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("ur")).toBe(true);
    expect(isRtl("en")).toBe(false);
  });

  it("directionOf falls back to ltr for unknown codes", () => {
    expect(directionOf("zz")).toBe("ltr");
    expect(directionOf(null)).toBe("ltr");
  });

  it("getLanguage is case-insensitive and returns endonyms", () => {
    expect(getLanguage("HI")?.nativeName).toBe("हिन्दी");
    expect(getLanguage("ar")?.nativeName).toBe("العربية");
    expect(getLanguage("nope")).toBeUndefined();
  });
});

describe("resolveLocale", () => {
  it("exact match wins", () => {
    expect(resolveLocale("fr")).toBe("fr");
  });
  it("falls back to the base subtag (en-US → en)", () => {
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("ar-EG")).toBe("ar");
  });
  it("returns the default for unknown / empty input", () => {
    expect(resolveLocale("xx")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
  });
  it("respects an enabled-set filter", () => {
    const enabled = new Set(["en", "hi"]);
    expect(resolveLocale("fr", enabled)).toBe("en"); // fr disabled → default
    expect(resolveLocale("hi", enabled)).toBe("hi");
  });
});

describe("translate", () => {
  const dict = { greeting: "Hello {name}", plain: "Plain" };
  const fallback = { greeting: "Hi", only_en: "English only" };

  it("returns the active-dict value", () => {
    expect(translate(dict, "plain")).toBe("Plain");
  });
  it("interpolates {vars}", () => {
    expect(translate(dict, "greeting", { name: "Sid" })).toBe("Hello Sid");
  });
  it("leaves unknown placeholders untouched", () => {
    expect(translate(dict, "greeting", {})).toBe("Hello {name}");
  });
  it("falls back to the fallback dict, then to the key", () => {
    expect(translate(dict, "only_en", undefined, fallback)).toBe("English only");
    expect(translate(dict, "missing.key", undefined, fallback)).toBe("missing.key");
  });
});

describe("messages dictionaries", () => {
  it("English covers every key used by other locales", () => {
    const en = MESSAGES.en;
    for (const [code, d] of Object.entries(MESSAGES)) {
      for (const key of Object.keys(d)) {
        expect(en, `en missing key ${key} present in ${code}`).toHaveProperty(key);
      }
    }
  });
  it("dictFor falls back to English for an unknown locale", () => {
    expect(dictFor("zz")).toBe(MESSAGES.en);
  });
  it("RTL locales carry real translations (not English)", () => {
    expect(MESSAGES.ar["common.signOut"]).not.toBe(MESSAGES.en["common.signOut"]);
    expect(MESSAGES.ur["common.signOut"]).not.toBe(MESSAGES.en["common.signOut"]);
  });
});
