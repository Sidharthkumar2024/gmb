"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";

// Shell for the Adgrowly GMB Suite: 248px sidebar + 64px header, per the
// design file. Every figure it shows is fetched — locations, credits and the
// visibility score are real API reads, not props, so a screen can never
// disagree with the chrome around it.

export interface GmbLocationLite {
  id: string;
  name: string;
  city?: string | null;
  status?: string | null;
  score?: number | null;
}

const NAV: Array<{ label: string; items: Array<{ href: string; name: string; badgeKey?: string }> }> = [
  {
    label: "Overview",
    items: [
      { href: "/gmb-dashboard", name: "Dashboard" },
      { href: "/gmb-insights", name: "Insights" },
      { href: "/gmb-reports", name: "Reports" },
    ],
  },
  {
    label: "Grow",
    items: [
      { href: "/gmb-reputation", name: "Reviews", badgeKey: "reviews" },
      { href: "/gmb-qa", name: "Q&A", badgeKey: "questions" },
      { href: "/gmb", name: "Posts" },
      { href: "/gmb-images", name: "Photos" },
      { href: "/gmb-ranking", name: "Rank tracker" },
      { href: "/gmb-citations", name: "Citations" },
      { href: "/gmb-advisor", name: "Advisor" },
    ],
  },
  {
    label: "Profile",
    items: [
      { href: "/gmb-locations", name: "Locations" },
      { href: "/gmb-actions", name: "Action links" },
      { href: "/gmb-verifications", name: "Verification" },
      { href: "/gmb-settings", name: "Settings" },
    ],
  },
];

function initials(name: string | undefined, email: string | undefined): string {
  const src = (name ?? "").trim() || (email ?? "").split("@")[0] || "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || src[0]!.toUpperCase();
}

/** Green above 70, amber above 40, red below — matches the design's dots. */
function scoreTone(score: number | null | undefined): string {
  if (typeof score !== "number") return "#8d8aa3";
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#b25e09";
  return "#d92d20";
}

function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);
  return ref;
}

export function GmbShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [locations, setLocations] = useState<GmbLocationLite[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [credits, setCredits] = useState<number | null>(null);
  const [score, setScore] = useState<{ value: number; grade: string | null } | null>(null);
  const [locMenu, setLocMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);

  // Auth lives in localStorage, so the server renders a signed-out shell while
  // the client renders a signed-in one. React treats that as a hydration
  // mismatch and throws away the whole document — slow, and it briefly paints
  // the wrong content. Holding the first client render identical to the
  // server's (a neutral skeleton) removes the divergence entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const locRef = useOutsideClose(useCallback(() => setLocMenu(false), []));
  const userRef = useOutsideClose(useCallback(() => setUserMenu(false), []));

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    void api
      .get<GmbLocationLite[]>("/api/v1/gmb/locations")
      .then((rows) => {
        if (cancelled) return;
        setLocations(rows ?? []);
        // Restore the last choice so switching pages doesn't reset it.
        const saved = window.localStorage.getItem("gmb_active_location");
        const valid = rows?.some((r) => r.id === saved);
        setActiveId(valid ? saved! : (rows?.[0]?.id ?? ""));
      })
      .catch(() => undefined);

    void api
      .get<{ primaryWallet?: { balanceCredits?: number } }>("/api/v1/customer/wallets")
      .then((d) => {
        if (!cancelled && typeof d.primaryWallet?.balanceCredits === "number") {
          setCredits(d.primaryWallet.balanceCredits);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [mounted]);

  useEffect(() => {
    if (!activeId) return;
    window.localStorage.setItem("gmb_active_location", activeId);
    let cancelled = false;
    void api
      .get<{ businessScore?: number | null; grade?: string | null }>(
        `/api/v1/gmb/dashboard?locationId=${activeId}`,
      )
      .then((d) => {
        if (!cancelled && typeof d.businessScore === "number") {
          // The design shows "+6 since last month". The API exposes no
          // month-over-month delta, so the grade is shown instead of inventing
          // a trend — a fabricated number here would be indistinguishable from
          // a real one to whoever reads it.
          setScore({ value: d.businessScore, grade: d.grade ?? null });
        }
      })
      // The score is chrome; a failure must not surface as an error.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const active = useMemo(
    () => locations.find((l) => l.id === activeId) ?? null,
    [locations, activeId],
  );

  // Everything below depends on localStorage (auth token, chosen location), so
  // the server literally cannot render it correctly. Rather than emit a
  // signed-out tree and let React discard the whole document on hydration,
  // render a neutral skeleton until mount. Server HTML and the first client
  // render are then byte-identical, so hydration is clean and React patches in
  // the real content on the next tick.
  if (!mounted) {
    return (
      <div className="flex h-screen overflow-hidden bg-gmb-canvas font-geist text-gmb-ink">
        <aside className="w-[248px] flex-shrink-0 border-r border-gmb-line bg-gmb-surface" />
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="h-16 flex-shrink-0 border-b border-gmb-line bg-gmb-canvas" />
          <div className="flex-1" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gmb-canvas font-geist text-gmb-ink">
      {/* ---------------- Sidebar ---------------- */}
      <aside className="flex w-[248px] flex-shrink-0 flex-col border-r border-gmb-line bg-gmb-surface">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-gradient-to-br from-gmb-brand-light to-gmb-brand-lighter text-sm font-bold text-white">
            G
          </div>
          <div>
            <div className="text-base font-bold leading-none tracking-[-0.01em]">GMB Suite</div>
            <div className="mt-[3px] font-geist-mono text-micro uppercase tracking-[0.1em] text-gmb-ink-subtle">
              by Adgrowly
            </div>
          </div>
        </div>

        {/* Location switcher */}
        <div className="relative mx-3 mb-3 mt-1" ref={locRef}>
          <button
            type="button"
            onClick={() => setLocMenu((v) => !v)}
            className="flex w-full items-center gap-2 rounded-[9px] border border-gmb-line bg-gmb-canvas px-3 py-2 text-left hover:bg-gmb-line-soft"
          >
            <span
              className="h-[7px] w-[7px] flex-shrink-0 rounded-full"
              style={{ background: scoreTone(active?.score) }}
            />
            {/* Auth and the chosen location live in localStorage, so the server
                cannot know them. The divergence is intentional, not a bug, and
                suppressHydrationWarning is React's supported way to say so —
                without it React discards the whole document on hydration. */}
            <div className="min-w-0 flex-1">
              <div
                suppressHydrationWarning
                className="truncate text-xs font-semibold text-gmb-ink"
              >
                {!mounted
                  ? "Loading…"
                  : (active?.name ?? (locations.length ? "Select location" : "No locations"))}
              </div>
              <div
                suppressHydrationWarning
                className="font-geist-mono text-micro text-gmb-ink-subtle"
              >
                {!mounted ? " " : (active?.city ?? (locations.length ? "—" : "Add one to begin"))}
              </div>
            </div>
            <span className="text-[10px] text-gmb-ink-subtle">▾</span>
          </button>

          {locMenu && (
            <div className="absolute left-0 right-0 top-[46px] z-30 rounded-xl border border-gmb-line bg-gmb-surface p-[5px] shadow-menu">
              {locations.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    setActiveId(l.id);
                    setLocMenu(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-gmb-canvas ${
                    l.id === activeId ? "bg-gmb-brand-wash" : ""
                  }`}
                >
                  <span
                    className="h-[7px] w-[7px] flex-shrink-0 rounded-full"
                    style={{ background: scoreTone(l.score) }}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-xs text-gmb-ink ${
                        l.id === activeId ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {l.name}
                    </div>
                    <div className="font-geist-mono text-micro text-gmb-ink-subtle">
                      {l.city ?? "—"}
                    </div>
                  </div>
                  {typeof l.score === "number" && (
                    <span
                      className="font-geist-mono text-[10px]"
                      style={{ color: scoreTone(l.score) }}
                    >
                      {l.score}
                    </span>
                  )}
                </button>
              ))}
              <Link
                href="/gmb-locations"
                onClick={() => setLocMenu(false)}
                className="mt-1 block w-full rounded-lg border border-dashed border-gmb-brand-border bg-gmb-brand-wash p-2 text-center text-xs2 font-semibold text-gmb-brand no-underline hover:no-underline"
              >
                Manage all locations →
              </Link>
            </div>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-3 pb-3">
          {NAV.map((section) => (
            <div key={section.label}>
              <div className="px-2.5 pb-[7px] font-geist-mono text-micro uppercase tracking-[0.1em] text-gmb-ink-subtle">
                {section.label}
              </div>
              <div className="flex flex-col gap-px">
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/gmb" && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-[7px] text-[13px] no-underline hover:no-underline ${
                        isActive
                          ? "bg-gmb-brand-tint font-semibold text-gmb-brand"
                          : "font-medium text-gmb-ink-muted hover:bg-gmb-line-soft"
                      }`}
                    >
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="m-3 rounded-[14px] bg-gradient-to-br from-gmb-brand-light to-gmb-brand-lighter p-3.5 text-white">
          <div className="text-sm2 font-semibold">Local visibility score</div>
          <div className="mt-1 text-3xl font-bold tracking-[-0.02em]">
            {mounted && score ? score.value : "—"}
            <span className="text-sm font-medium opacity-70">/100</span>
          </div>
          <div className="mt-0.5 text-[11px] opacity-85">
            {mounted && score
              ? score.grade
                ? `Grade ${score.grade}`
                : "From your latest advisor run"
              : "Run the advisor to see your score"}
          </div>
        </div>
      </aside>

      {/* ---------------- Main ---------------- */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-shrink-0 items-center gap-3.5 border-b border-gmb-line bg-gmb-canvas px-7">
          <h1 className="m-0 flex-shrink-0 text-[21px] font-bold tracking-[-0.01em]">{title}</h1>
          <div className="flex-1" />

          <input
            placeholder="Search keywords, reviews…"
            className="w-[220px] rounded-[9px] border border-gmb-line bg-gmb-surface px-3 py-2 text-sm2 text-gmb-ink outline-none placeholder:text-gmb-ink-subtle"
          />

          <span
            title="AI credits remaining"
            className="flex items-center gap-[7px] rounded-full border border-gmb-line bg-gmb-surface px-3 py-1.5"
          >
            <span className="h-[7px] w-[7px] rounded-full bg-gmb-brand-light" />
            <span className="font-geist-mono text-[11px] text-gmb-ink-muted">
              {!mounted || credits === null ? "—" : credits.toLocaleString()} credits
            </span>
          </span>

          <div className="relative" ref={userRef}>
            <button
              type="button"
              onClick={() => setUserMenu((v) => !v)}
              aria-label="Account menu"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gmb-brand text-xs font-semibold text-white"
            >
              {mounted ? initials(user?.name, user?.email) : ""}
            </button>

            {userMenu && (
              <div className="absolute right-0 top-[42px] z-20 w-[230px] rounded-[14px] border border-gmb-line bg-gmb-surface p-1.5 shadow-menu">
                <div className="border-b border-gmb-line-soft px-3 py-2.5">
                  <div className="text-[13px] font-semibold">{user?.name || "—"}</div>
                  <div className="mt-0.5 truncate font-geist-mono text-[10px] text-gmb-ink-subtle">
                    {user?.email}
                  </div>
                </div>
                <Link
                  href="/gmb-settings"
                  onClick={() => setUserMenu(false)}
                  className="block rounded-[9px] px-3 py-2.5 text-sm2 text-gmb-ink no-underline hover:bg-gmb-canvas hover:no-underline"
                >
                  Settings
                </Link>
                <Link
                  href="/gmb-connect"
                  onClick={() => setUserMenu(false)}
                  className="block rounded-[9px] px-3 py-2.5 text-sm2 text-gmb-ink no-underline hover:bg-gmb-canvas hover:no-underline"
                >
                  Google connection
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenu(false);
                    void signOut();
                    router.push("/login");
                  }}
                  className="w-full border-t border-gmb-line-soft px-3 py-2.5 text-left text-sm2 text-gmb-danger hover:bg-gmb-danger-bg"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-7 pb-10 pt-6">{children}</div>
      </main>
    </div>
  );
}

/** The active location id, for screens that need to scope their reads. */
export function useActiveLocationId(): string {
  const [id, setId] = useState("");
  useEffect(() => {
    setId(window.localStorage.getItem("gmb_active_location") ?? "");
  }, []);
  return id;
}
