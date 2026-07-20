import { GmbPostType } from "@nexaflow/db";

// =====================================================================
// Niche-aware Google Business Profile post copy. A curated catalog of business
// niches, each with a short brand-flavor clause and sensible default topics per
// post type. `nicheCaption` composes a caption that genuinely differs by tone
// (professional vs friendly) and by niche — replacing the old single template
// where "professional" and "friendly" produced identical text. Pure + unit-
// tested; the AI path (draftGmbCaption) layers real LLM copy on top using the
// same niche/tone variables.
// =====================================================================

export const POST_TONES = ["professional", "friendly"] as const;
export type PostTone = (typeof POST_TONES)[number];

/** Map any legacy/loose tone value onto the two supported tones. */
export function normalizeTone(raw?: string | null): PostTone {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "professional" || t === "formal" || t === "warm") return "professional";
  // friendly | playful | casual | anything else → friendly (the upbeat default)
  return "friendly";
}

interface Niche {
  key: string;
  label: string;
  /** A short brand-appropriate clause reused across post types. */
  flavor: string;
  /** Fallback subject per post type when the user gives no topic. */
  defaults: Record<GmbPostType, string>;
}

const GENERIC: Niche = {
  key: "general",
  label: "General business",
  flavor: "quality service our customers trust",
  defaults: {
    [GmbPostType.OFFER]: "a limited-time deal",
    [GmbPostType.EVENT]: "an upcoming event",
    [GmbPostType.UPDATE]: "something new to share",
  },
};

const NICHES: Niche[] = [
  GENERIC,
  {
    key: "restaurant",
    label: "Restaurant & Cafe",
    flavor: "freshly prepared dishes made to order",
    defaults: {
      [GmbPostType.OFFER]: "our weekend special menu",
      [GmbPostType.EVENT]: "a live-music dinner night",
      [GmbPostType.UPDATE]: "new dishes on the menu",
    },
  },
  {
    key: "salon",
    label: "Salon & Spa",
    flavor: "expert cuts, colour and care from our stylists",
    defaults: {
      [GmbPostType.OFFER]: "a seasonal grooming package",
      [GmbPostType.EVENT]: "a bridal styling day",
      [GmbPostType.UPDATE]: "a new treatment on our menu",
    },
  },
  {
    key: "clinic",
    label: "Clinic & Healthcare",
    flavor: "trusted care from our qualified team",
    defaults: {
      [GmbPostType.OFFER]: "a health check-up package",
      [GmbPostType.EVENT]: "a free wellness camp",
      [GmbPostType.UPDATE]: "extended consultation hours",
    },
  },
  {
    key: "retail",
    label: "Retail & Store",
    flavor: "hand-picked products at everyday value",
    defaults: {
      [GmbPostType.OFFER]: "a store-wide sale",
      [GmbPostType.EVENT]: "a new-collection launch",
      [GmbPostType.UPDATE]: "fresh stock just arrived",
    },
  },
  {
    key: "gym",
    label: "Gym & Fitness",
    flavor: "results-driven training with certified coaches",
    defaults: {
      [GmbPostType.OFFER]: "a new-member membership deal",
      [GmbPostType.EVENT]: "a free trial fitness class",
      [GmbPostType.UPDATE]: "new equipment on the floor",
    },
  },
  {
    key: "realestate",
    label: "Real Estate",
    flavor: "handpicked properties and honest guidance",
    defaults: {
      [GmbPostType.OFFER]: "a limited-period booking offer",
      [GmbPostType.EVENT]: "an open-house site visit",
      [GmbPostType.UPDATE]: "a new project listing",
    },
  },
  {
    key: "automotive",
    label: "Automotive & Service",
    flavor: "reliable servicing by trained technicians",
    defaults: {
      [GmbPostType.OFFER]: "a seasonal service package",
      [GmbPostType.EVENT]: "a free vehicle check-up camp",
      [GmbPostType.UPDATE]: "new services now available",
    },
  },
  {
    key: "education",
    label: "Education & Coaching",
    flavor: "proven teaching that gets real results",
    defaults: {
      [GmbPostType.OFFER]: "an early-bird admission offer",
      [GmbPostType.EVENT]: "a free demo class",
      [GmbPostType.UPDATE]: "a new batch starting soon",
    },
  },
  {
    key: "hotel",
    label: "Hotel & Hospitality",
    flavor: "warm hospitality and comfortable stays",
    defaults: {
      [GmbPostType.OFFER]: "a weekend staycation package",
      [GmbPostType.EVENT]: "a festive brunch",
      [GmbPostType.UPDATE]: "newly refreshed rooms",
    },
  },
];

const NICHE_BY_KEY = new Map(NICHES.map((n) => [n.key, n]));

/** The niche catalog for the frontend picker: [{ key, label }]. */
export function listNiches(): { key: string; label: string }[] {
  return NICHES.map((n) => ({ key: n.key, label: n.label }));
}

export function resolveNiche(key?: string | null): Niche {
  return NICHE_BY_KEY.get((key ?? "").trim().toLowerCase()) ?? GENERIC;
}

/**
 * Pure: compose a niche- and tone-aware caption body for a post type. Professional
 * reads measured and trustworthy; friendly reads upbeat and personable (with a
 * light emoji). The niche `flavor` clause makes the copy feel industry-specific
 * even before the AI layer runs.
 */
export function nicheCaption(input: {
  businessName: string;
  type: GmbPostType;
  topic?: string | null;
  tone: PostTone;
  niche?: string | null;
}): string {
  const name = input.businessName.trim() || "We";
  const niche = resolveNiche(input.niche);
  const subject = (input.topic ?? "").trim() || niche.defaults[input.type];
  const flavor = niche.flavor;
  const pro = input.tone === "professional";

  if (input.type === GmbPostType.OFFER) {
    return pro
      ? `${name} is pleased to offer ${subject}. Enjoy ${flavor}. Visit us or get in touch to take advantage of this offer.`
      : `🎉 ${name} has ${subject}! Enjoy ${flavor} — don't miss out, come see us today!`;
  }
  if (input.type === GmbPostType.EVENT) {
    return pro
      ? `${name} invites you to ${subject}. Experience ${flavor}. We look forward to welcoming you.`
      : `📅 You're invited! ${name} is hosting ${subject}. Come for ${flavor} — save the date and join us!`;
  }
  return pro
    ? `An update from ${name}: ${subject}. As always, expect ${flavor}. Contact us to learn more.`
    : `✨ News from ${name} — ${subject}! Expect ${flavor}. Reach out and say hi!`;
}
