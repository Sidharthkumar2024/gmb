// Pure route-match scoring for the AppShell nav.
//
// Extracted from AppShell.tsx so the algorithm can be unit-tested in
// isolation — the prior inline implementation was the kind of code that
// looks obviously right and isn't. Three rules pinned here:
//
//   1. Exact pathname match always beats prefix match. A user on
//      `/dashboard/ai-agents` highlights the "AI agents" nav item, never
//      the "Overview" parent.
//   2. Among prefix matches, the longest route wins. So `/contacts/123`
//      highlights "/contacts" if no more-specific item exists.
//   3. `/dashboard` is excluded from prefix-matching specifically because
//      every dashboard subroute would otherwise inherit the "Overview"
//      highlight. Exact `/dashboard` still matches itself.
//
// No React imports here — these helpers are testable straight from
// vitest with synthetic data.

export interface NavRoute {
  href: string;
  /** Extra paths that should also light this nav entry up. */
  activeRoutes?: string[];
}

const PREFIX_BLOCKLIST = new Set(["/dashboard"]);

/**
 * Score how well `pathname` matches the nav entry. Higher is better.
 *   - Exact match → `route.length + 1000` (always beats any prefix).
 *   - Prefix match → `route.length` (longer prefix wins ties).
 *   - No match    → -1.
 */
export function routeMatchScore(pathname: string, item: NavRoute): number {
  const routes = [item.href, ...(item.activeRoutes ?? [])];
  let score = -1;

  for (const route of routes) {
    if (pathname === route) {
      score = Math.max(score, route.length + 1000);
    } else if (!PREFIX_BLOCKLIST.has(route) && pathname.startsWith(`${route}/`)) {
      score = Math.max(score, route.length);
    }
  }

  return score;
}

export function isActiveRoute(pathname: string, item: NavRoute): boolean {
  return routeMatchScore(pathname, item) >= 0;
}

export interface NavSectionLike {
  items: NavRoute[];
}

/**
 * Walk every section + item, pick the one with the highest match score.
 * Returns the winning `href` or null if nothing matches.
 */
export function activeHrefFromPath(
  pathname: string,
  sections: NavSectionLike[],
): string | null {
  let best: { href: string; score: number } | null = null;

  for (const section of sections) {
    for (const item of section.items) {
      const score = routeMatchScore(pathname, item);
      if (score > (best?.score ?? -1)) {
        best = { href: item.href, score };
      }
    }
  }

  return best?.href ?? null;
}
