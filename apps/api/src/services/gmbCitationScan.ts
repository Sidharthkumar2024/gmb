import { compareNap, type Nap, type NapComparison } from "./gmbCitation.service";

// =====================================================================
// Citation NAP scanner — pure. Given a location's canonical NAP and its tracked
// listings, flag which directories are inconsistent, and recommend niche-
// relevant directories the business isn't listed on yet. There is no universal
// directory-submission API, so this automates detection + a to-do checklist —
// not auto-submission. The DB-backed scanCitations wraps this.
// =====================================================================

// Directories every local business should be on, regardless of niche.
const BASE_DIRECTORIES = [
  "Google Business Profile",
  "Justdial",
  "Bing Places",
  "Apple Maps",
  "Facebook",
  "Sulekha",
];

// Niche-specific directories, keyed by the gmbNiche catalog keys.
const NICHE_DIRECTORIES: Record<string, string[]> = {
  restaurant: ["Zomato", "Swiggy", "TripAdvisor", "EazyDiner", "Dineout"],
  salon: ["Urban Company", "Fresha", "StyleSeat"],
  clinic: ["Practo", "Lybrate", "1mg"],
  retail: ["IndiaMART", "Amazon", "Flipkart"],
  gym: ["Cult.fit", "Gympik"],
  realestate: ["99acres", "MagicBricks", "Housing.com"],
  automotive: ["CarDekho", "CarTrade"],
  education: ["UrbanPro", "Shiksha"],
  hotel: ["MakeMyTrip", "Booking.com", "Agoda", "TripAdvisor"],
  general: [],
};

/** Recommended directories for a niche: the base set plus niche-specific ones. */
export function recommendedDirectories(niche?: string | null): string[] {
  const key = (niche ?? "").trim().toLowerCase();
  const extra = NICHE_DIRECTORIES[key] ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of [...BASE_DIRECTORIES, ...extra]) {
    const k = d.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(d);
    }
  }
  return out;
}

export interface CitationScanMismatch {
  id: string;
  directory: string;
  comparison: NapComparison;
}

export interface CitationScanResult {
  scanned: number;
  /** Present listings whose NAP doesn't fully match the canonical profile. */
  mismatches: CitationScanMismatch[];
  /** Recommended directories the business isn't tracking a listing for yet. */
  missingRecommended: string[];
  consistencyScore: number;
}

interface ScanCitationLike {
  id: string;
  directory: string;
  status: string; // GmbCitationStatus
  nap: Nap;
}

/**
 * Pure: given the canonical NAP + tracked listings + niche, produce the scan
 * report. A listing counts as a mismatch when it is present (not MISSING) and
 * not fully consistent. `missingRecommended` is the niche checklist minus what's
 * already tracked (case-insensitive on directory name).
 */
export function buildCitationScan(
  canonical: Nap,
  citations: ScanCitationLike[],
  niche?: string | null,
): CitationScanResult {
  const mismatches: CitationScanMismatch[] = [];
  let present = 0;
  let consistent = 0;
  for (const c of citations) {
    if (c.status === "MISSING") continue;
    present += 1;
    const comparison = compareNap(canonical, c.nap);
    if (comparison.consistent) consistent += 1;
    else mismatches.push({ id: c.id, directory: c.directory, comparison });
  }

  const tracked = new Set(citations.map((c) => c.directory.trim().toLowerCase()));
  const missingRecommended = recommendedDirectories(niche).filter(
    (d) => !tracked.has(d.toLowerCase()),
  );

  return {
    scanned: citations.length,
    mismatches,
    missingRecommended,
    consistencyScore: present ? Math.round((consistent / present) * 100) / 100 : 0,
  };
}
