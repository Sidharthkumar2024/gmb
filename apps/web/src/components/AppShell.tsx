"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthUserPublic } from "@nexaflow/shared";
import {
  api,
  fetchCurrencySettings,
  fetchCustomerProductAccess,
  fetchLanguageSettings,
  updateCurrencyPreference,
  updateLanguagePreference,
  type CustomerProductAccessResponse,
  type TenantCurrencySettings,
  type TenantLanguageSettings,
} from "../lib/api";
import {
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  GitBranch,
  Share2,
  ShoppingBag,
  Building2,
  ArrowRightLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  CreditCard,
  FileText,
  Globe,
  Headphones,
  Inbox,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  MapPin,
  Mail,
  Megaphone,
  Instagram,
  Menu,
  MessageSquare,
  Package,
  Plug,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  QrCode,
  Tag,
  UserCircle,
  Users,
  WalletCards,
  Workflow,
  Zap,
  X,
  type LucideIcon,
} from "lucide-react";
import { activeHrefFromPath, isActiveRoute } from "../lib/navActive";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { CurrencySwitcher } from "./CurrencySwitcher";
import { useI18n } from "../i18n/I18nProvider";

type RoleName =
  | "SUPER_ADMIN"
  | "WHITE_LABEL_ADMIN"
  | "BUSINESS_ADMIN"
  | "TEAM_LEAD"
  | "AGENT";

export interface AppNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: RoleName[];
  feature?: string;
  product?: string;
  activeRoutes?: string[];
}

interface AppNavSection {
  label?: string;
  items: AppNavItem[];
}

const BUSINESS_ROLES: RoleName[] = ["BUSINESS_ADMIN", "TEAM_LEAD"];
const INBOX_ROLES: RoleName[] = ["BUSINESS_ADMIN", "TEAM_LEAD", "AGENT"];
const ALL_DASHBOARD_ROLES: RoleName[] = [
  "SUPER_ADMIN",
  "WHITE_LABEL_ADMIN",
  "BUSINESS_ADMIN",
  "TEAM_LEAD",
  "AGENT",
];

// GMB-only navigation. The monorepo shipped seven sections (Workspace,
// Automation, Operations, More, Platform, Partner); every one of them pointed
// at routes that do not exist in this app, so they are removed rather than
// left as dead links.
export const APP_NAV_SECTIONS: AppNavSection[] = [
  {
    label: "Local SEO (GMB)",
    items: [
      // Every item that calls /api/v1/gmb carries product: "local_seo" so the
      // nav matches what the API will actually answer. AI Visibility, Store
      // locator and Managed are deliberately NOT tagged — they hit different
      // APIs and keep working when Local SEO isn't sold. (An empty section is
      // dropped by filterSections, so turning the product off hides the group.)
      { href: "/gmb-dashboard", label: "Home", icon: LayoutGrid, roles: BUSINESS_ROLES, product: "local_seo" },
      { href: "/gmb-reputation", label: "Reputation", icon: Star, roles: BUSINESS_ROLES, product: "local_seo" },
      { href: "/gmb-ranking", label: "Rankings", icon: Globe, roles: BUSINESS_ROLES, product: "local_seo" },
      // Content hub = GBP posts + the AI authoring tools (Descriptions/Images/Advisor) linked from that page.
      { href: "/gmb", label: "Content", icon: Calendar, roles: BUSINESS_ROLES, product: "local_seo", activeRoutes: ["/gmb", "/gmb-descriptions", "/gmb-images", "/gmb-advisor"] },
      { href: "/gmb-insights", label: "Insights", icon: BarChart3, roles: BUSINESS_ROLES, product: "local_seo" },
      { href: "/gmb-reports", label: "Reports", icon: FileText, roles: BUSINESS_ROLES, product: "local_seo" },
      { href: "/gmb-citations", label: "Citations", icon: MapPin, roles: BUSINESS_ROLES, product: "local_seo" },
      { href: "/gmb-locations", label: "Profile", icon: Building2, roles: BUSINESS_ROLES, product: "local_seo" },
    ],
  }
];

// Mobile bottom bar. Resolved against the filtered nav, so entries that are not
// in this app's sections are simply dropped — these are the GMB equivalents of
// the monorepo's dashboard/inbox/campaigns/contacts/wallet row.
const BOTTOM_NAV_ITEMS = [
  "/gmb-dashboard",
  "/gmb-reputation",
  "/gmb-ranking",
  "/gmb",
  "/gmb-locations",
];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// Maps a nav label to its i18n key (nav.<slug>). The data array keeps the
// English label as the source of truth; the EN dictionary holds every
// nav.<slug>, so any untranslated locale falls back to English. This keeps
// the nav structure itself untouched (i18n lives only at the render sites).
function navKey(label: string): string {
  return "nav." + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function translatedNavLabel(t: (key: string) => string, label: string): string {
  const key = navKey(label);
  const translated = t(key);
  return translated === key ? label : translated;
}

// Route-match scoring lives in src/lib/navActive.ts so it can be
// unit-tested in isolation — see navActive.test.ts for the pinned
// rules (exact > prefix, longest-wins, /dashboard blocklist).

function filterSections(
  user: AuthUserPublic,
  features?: Record<string, boolean> | null,
  products?: Record<string, boolean> | null,
) {
  const isFeatureOn = (key?: string) =>
    !key || !features || features[key] !== false;
  const isProductOn = (key?: string) =>
    !key || !products || products[key] !== false;

  return APP_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        item.roles.includes(user.role as RoleName) &&
        isFeatureOn(item.feature) &&
        isProductOn(item.product),
    ),
  })).filter((section) => section.items.length > 0);
}

function pageTitleFromPath(pathname: string, sections: AppNavSection[]) {
  for (const section of sections) {
    const item = section.items.find((entry) => isActiveRoute(pathname, entry));
    if (item) return item.label;
  }
  return "Dashboard";
}

export function NavItem({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: AppNavItem;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;
  const label = translatedNavLabel(t, item.label);
  return (
    <Link
      href={item.href}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      data-nav-href={item.href}
      data-nav-active={active ? "true" : "false"}
      onClick={onNavigate}
      className={cn(
        "group flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition",
        collapsed && "justify-center px-0",
        active
          ? "bg-[#e9f2ec] text-[#16753c]"
          : "text-[#56544a] hover:bg-[#efeadd] hover:text-[#1f1d17]",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 flex-none",
          active ? "text-[#16753c]" : "text-[#aaa593] group-hover:text-[#56544a]",
        )}
      />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

export function Sidebar({
  sections,
  activeHref,
  collapsed,
  onToggleCollapsed,
  user,
  signOut,
}: {
  sections: AppNavSection[];
  activeHref: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  user: AuthUserPublic;
  signOut: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside
      className={cn(
        "hidden border-r border-[#e7e2d4] bg-[#fbfaf5] md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:flex-col",
        collapsed ? "md:w-20" : "md:w-72",
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b border-[#e7e2d4] px-4",
          collapsed ? "justify-center" : "justify-between gap-3",
        )}
      >
        <Link href="/gmb-dashboard" className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-[#16753c] text-base font-black text-white shadow-sm">
            A
          </span>
          {!collapsed && (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[15px] font-bold text-[#1f1d17]">
                Adgrowly
              </span>
              <span className="ag-mono truncate text-[9px] font-semibold">
                {user.role === "SUPER_ADMIN" ? "Admin panel" : "Business panel"}
              </span>
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse sidebar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#908c7c] hover:bg-[#efeadd] hover:text-[#1f1d17]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand sidebar"
          className="mx-auto mt-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      <nav className="nx-scroll flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {sections.map((section, sectionIndex) => (
          <div key={section.label ?? sectionIndex}>
            {section.label && !collapsed && (
              <div className="flex items-center justify-between px-3 pb-1.5">
                <span className="ag-mono text-[9.5px] font-semibold">
                  {translatedNavLabel(t, section.label)}
                </span>
                <span className="text-[10px] font-semibold text-[#c9c3b2]">
                  {section.items.length}
                </span>
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  active={item.href === activeHref}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Upgrade card (Adgrowly design) — a customer upsell. Hidden when
          collapsed and never shown to platform admins. */}
      {!collapsed && user.role !== "SUPER_ADMIN" && (
        <div className="px-3 pb-2">
          <Link
            href="/gmb-reports"
            className="block overflow-hidden rounded-2xl bg-gradient-to-br from-[#16753c] to-[#123823] p-4 text-white shadow-medium transition hover:from-[#155e32] hover:to-[#0f2e1d]"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-[#a9d6b8]">
              <Sparkles className="h-3.5 w-3.5" />
              Upgrade
            </div>
            <p className="mt-1.5 text-sm font-bold leading-snug">
              Unlock AI Receptionist &amp; grid tracking
            </p>
            <span className="mt-3 inline-flex rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#16753c]">
              See plans
            </span>
          </Link>
        </div>
      )}

      <div className="border-t border-[#e7e2d4] p-3">
        <SidebarUserCard collapsed={collapsed} user={user} signOut={signOut} />
      </div>
    </aside>
  );
}

function SidebarUserCard({
  collapsed,
  user,
  signOut,
}: {
  collapsed: boolean;
  user: AuthUserPublic;
  signOut: () => void;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={signOut}
        title="Log out"
        className="flex h-10 w-full items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
      >
        <LogOut className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-700 shadow-sm">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">
            {user.name}
          </div>
          <div className="truncate text-xs text-slate-500">{user.email}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-950"
      >
        <LogOut className="h-3.5 w-3.5" />
        Log out
      </button>
    </div>
  );
}

export function MobileDrawer({
  open,
  sections,
  activeHref,
  onClose,
  user,
  signOut,
  currencySettings,
  onCurrencyChange,
  currencyLocked,
  onLocaleChange,
  languageLocked,
}: {
  open: boolean;
  sections: AppNavSection[];
  activeHref: string | null;
  onClose: () => void;
  user: AuthUserPublic;
  signOut: () => void;
  currencySettings?: TenantCurrencySettings | null;
  onCurrencyChange?: (currencyCode: string) => void;
  currencyLocked?: boolean;
  onLocaleChange?: (locale: string) => void;
  languageLocked?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close navigation overlay"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-slate-950/45 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <aside
        className={cn(
          "absolute left-0 top-0 flex h-full w-[min(88vw,22rem)] flex-col bg-white shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <Link href="/gmb-dashboard" onClick={onClose} className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-base font-black text-white">
              N
            </span>
            <span className="text-sm font-black text-slate-950">NexaFlow AI</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {sections.map((section, sectionIndex) => (
            <div key={section.label ?? sectionIndex}>
              {section.label && (
                <div className="px-3 pb-2 text-[11px] font-bold uppercase text-slate-400">
                  {t(navKey(section.label))}
                </div>
              )}
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavItem
                    key={item.href}
                    item={item}
                    active={item.href === activeHref}
                    onNavigate={onClose}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs font-semibold text-slate-600">Currency</span>
            <CurrencySwitcher
              value={currencySettings?.setting.currencyCode ?? "INR"}
              currencies={currencySettings?.currencies ?? []}
              onCurrencyChange={onCurrencyChange}
              disabled={currencyLocked}
              className="max-w-[9rem]"
            />
          </div>
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs font-semibold text-slate-600">
              {t("common.language")}
            </span>
            <LocaleSwitcher
              onLocaleChange={onLocaleChange}
              disabled={languageLocked}
              className="max-w-[9rem]"
            />
          </div>
          <div className="mb-3 text-xs text-slate-500">
            Signed in as <span className="font-semibold text-slate-800">{user.name}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              signOut();
            }}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>
    </div>
  );
}

export function Topbar({
  title,
  user,
  onOpenMenu,
  signOut,
  currencySettings,
  onCurrencyChange,
  currencyLocked,
  onLocaleChange,
  languageLocked,
  walletCredits,
}: {
  title: string;
  user: AuthUserPublic;
  onOpenMenu: () => void;
  signOut: () => void;
  currencySettings?: TenantCurrencySettings | null;
  onCurrencyChange?: (currencyCode: string) => void;
  currencyLocked?: boolean;
  onLocaleChange?: (locale: string) => void;
  languageLocked?: boolean;
  walletCredits?: number | null;
}) {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-20 border-b border-[#e7e2d4] bg-[#fbfaf5]/85 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#e7e2d4] bg-white text-[#3c3a30] shadow-sm hover:bg-[#efeadd] md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="ag-serif truncate text-lg text-[#1f1d17] sm:text-xl">
            {title}
          </div>
          <div className="hidden text-xs capitalize text-[#908c7c] sm:block">
            {user.role.replaceAll("_", " ").toLowerCase()}
          </div>
        </div>

        <div className="hidden min-w-[15rem] items-center gap-2 rounded-xl border border-[#e7e2d4] bg-white px-3 py-2 text-sm text-[#908c7c] lg:flex">
          <Search className="h-4 w-4 text-[#aaa593]" />
          <span>{t("common.searchPlaceholder")}</span>
        </div>

        {/* AI credit balance. A read-only chip, not a link: this app has no
            wallet or checkout UI (see the billing caveat in the README), so
            linking it would dead-end. Restore the link once top-up exists. */}
        <span
          title="AI credits remaining"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-primary-100 bg-primary-50 px-3 text-xs font-bold text-primary-700"
        >
          <Coins className="h-4 w-4" />
          {typeof walletCredits === "number"
            ? `${walletCredits.toLocaleString()} credits`
            : currencySettings?.setting.currencyCode ?? "Wallet"}
        </span>

        <button
          type="button"
          aria-label="Notifications"
          className="hidden h-10 w-10 items-center justify-center rounded-xl border border-[#e7e2d4] bg-white text-[#56544a] hover:bg-[#efeadd] md:inline-flex"
        >
          <Bell className="h-4 w-4" />
        </button>

        <LocaleSwitcher
          onLocaleChange={onLocaleChange}
          disabled={languageLocked}
          className="hidden md:inline-flex"
        />

        <CurrencySwitcher
          value={currencySettings?.setting.currencyCode ?? "INR"}
          currencies={currencySettings?.currencies ?? []}
          onCurrencyChange={onCurrencyChange}
          disabled={currencyLocked}
          className="hidden w-[5.75rem] md:inline-flex"
        />

        <UserMenu user={user} signOut={signOut} />
      </div>
    </header>
  );
}

export function UserMenu({
  user,
  signOut,
}: {
  user: AuthUserPublic;
  signOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open profile menu"
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100"
      >
        <UserCircle className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
          <div className="px-3 py-2">
            <div className="truncate text-sm font-semibold text-slate-950">
              {user.name}
            </div>
            <div className="truncate text-xs text-slate-500">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="mt-1 flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function BottomNav({
  items,
  activeHref,
}: {
  items: AppNavItem[];
  activeHref: string | null;
}) {
  const { t } = useI18n();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
      <div className="mx-auto grid h-16 max-w-md grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-semibold",
                active ? "text-slate-950" : "text-slate-500 hover:text-slate-900",
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5",
                  active ? "text-emerald-600" : "text-slate-400",
                )}
              />
              <span className="max-w-full truncate">
                {t(navKey(item.label)).split(" ")[0]}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AppShell({
  user,
  features,
  products,
  signOut,
  children,
}: {
  user: AuthUserPublic;
  features?: Record<string, boolean> | null;
  products?: Record<string, boolean> | null;
  signOut: () => void;
  children: ReactNode;
}) {
  const { t, configureLanguages } = useI18n();
  const pathname = usePathname() ?? "/";
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [languageSettings, setLanguageSettings] =
    useState<TenantLanguageSettings | null>(null);
  const [currencySettings, setCurrencySettings] =
    useState<TenantCurrencySettings | null>(null);
  const [productAccess, setProductAccess] =
    useState<CustomerProductAccessResponse | null>(null);
  const [walletCredits, setWalletCredits] = useState<number | null>(null);
  const resolvedFeatures = useMemo(
    () => ({
      ...(features ?? {}),
      ...(productAccess?.features ?? {}),
    }),
    [features, productAccess?.features],
  );
  const resolvedProducts = productAccess?.productsByKey ?? products;
  const sections = useMemo(
    () => filterSections(user, resolvedFeatures, resolvedProducts),
    [resolvedFeatures, resolvedProducts, user],
  );
  const flatItems = sections.flatMap((section) => section.items);
  const title = t(navKey(pageTitleFromPath(pathname, sections)));
  const activeHref = activeHrefFromPath(pathname, sections);
  // The GMB routes render as the purple "GMB Suite" sub-workspace (its own
  // Adgrowly mockup) — a distinct theme scoped to the content region.
  const isGmbSuite =
    pathname.startsWith("/gmb") ||
    pathname.startsWith("/store-locator") ||
    pathname.startsWith("/managed-services");
  const bottomItems = BOTTOM_NAV_ITEMS.map((href) =>
    flatItems.find((item) => item.href === href),
  ).filter(Boolean) as AppNavItem[];
  const languageLocked = languageSettings
    ? !languageSettings.setting.canUpdatePreference
    : false;
  const currencyLocked = currencySettings
    ? !currencySettings.setting.canUpdatePreference
    : false;

  useEffect(() => {
    if (!user.tenantId) return;
    let cancelled = false;
    void fetchCustomerProductAccess()
      .then((access) => {
        if (!cancelled) setProductAccess(access);
      })
      .catch(() => {
        // Product access is a navigation enhancement; legacy feature flags
        // still keep the shell usable if this endpoint is temporarily down.
      });
    return () => {
      cancelled = true;
    };
  }, [user.tenantId]);

  useEffect(() => {
    if (!user.tenantId) return;
    let cancelled = false;
    void fetchLanguageSettings()
      .then((settings) => {
        if (cancelled) return;
        setLanguageSettings(settings);
        configureLanguages({
          languages: settings.languages,
          preferredLocale:
            settings.setting.locale || settings.setting.languageCode,
        });
      })
      .catch(() => {
        // Keep the build-time language list when tenant settings are unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [configureLanguages, user.tenantId]);

  // Wallet credits for the header chip (Adgrowly design). Best-effort;
  // the chip just hides its number if the call fails or the role has no
  // customer wallet (SuperAdmin/partner).
  useEffect(() => {
    if (!user.tenantId) return;
    let cancelled = false;
    void api
      .get<{ primaryWallet?: { balanceCredits?: number } }>(
        "/api/v1/customer/wallets",
      )
      .then((data) => {
        if (!cancelled && typeof data.primaryWallet?.balanceCredits === "number") {
          setWalletCredits(data.primaryWallet.balanceCredits);
        }
      })
      .catch(() => {
        /* chip degrades to a plain Wallet link */
      });
    return () => {
      cancelled = true;
    };
  }, [user.tenantId]);

  useEffect(() => {
    if (!user.tenantId) return;
    let cancelled = false;
    void fetchCurrencySettings()
      .then((settings) => {
        if (cancelled) return;
        setCurrencySettings(settings);
      })
      .catch(() => {
        // Currency controls can stay hidden when tenant settings are unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [user.tenantId]);

  const handleLocaleChange = useCallback(
    (locale: string) => {
      if (!languageSettings?.setting.canUpdatePreference) return;
      void updateLanguagePreference(locale, locale === "en" ? "en-IN" : locale)
        .then((settings) => {
          setLanguageSettings(settings);
          configureLanguages({
            languages: settings.languages,
            preferredLocale:
              settings.setting.locale || settings.setting.languageCode,
          });
        })
        .catch(() => {
          // The local switch already succeeded; a later reload will fall back
          // to the last saved tenant preference if the save could not complete.
        });
    },
    [configureLanguages, languageSettings?.setting.canUpdatePreference],
  );

  const handleCurrencyChange = useCallback(
    (currencyCode: string) => {
      if (!currencySettings?.setting.canUpdatePreference) return;
      const previousSettings = currencySettings;
      const nextCurrency = currencySettings.currencies.find(
        (currency) => currency.code === currencyCode,
      );
      if (nextCurrency) {
        setCurrencySettings({
          ...currencySettings,
          setting: {
            ...currencySettings.setting,
            currencyCode: nextCurrency.code,
            symbol: nextCurrency.symbol,
            minorUnit: nextCurrency.minorUnit,
          },
        });
      }
      void updateCurrencyPreference(currencyCode)
        .then((settings) => setCurrencySettings(settings))
        .catch(() => {
          setCurrencySettings(previousSettings);
        });
    },
    [currencySettings],
  );

  return (
    <div className="min-h-screen bg-[#f4f1e9]" data-active-href={activeHref ?? ""}>
      <ImpersonationBanner />
      <Sidebar
        sections={sections}
        activeHref={activeHref}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        user={user}
        signOut={signOut}
      />
      <MobileDrawer
        open={drawerOpen}
        sections={sections}
        activeHref={activeHref}
        onClose={() => setDrawerOpen(false)}
        user={user}
        signOut={signOut}
        currencySettings={currencySettings}
        onCurrencyChange={handleCurrencyChange}
        currencyLocked={currencyLocked}
        onLocaleChange={handleLocaleChange}
        languageLocked={languageLocked}
      />

      <div className={cn("min-h-screen", sidebarCollapsed ? "md:pl-20" : "md:pl-72")}>
        <Topbar
          title={title}
          user={user}
          onOpenMenu={() => setDrawerOpen(true)}
          signOut={signOut}
          currencySettings={currencySettings}
          onCurrencyChange={handleCurrencyChange}
          currencyLocked={currencyLocked}
          onLocaleChange={handleLocaleChange}
          languageLocked={languageLocked}
          walletCredits={walletCredits}
        />
        <main
          className={cn(
            "ag-content px-4 pb-28 pt-5 sm:px-6 lg:px-8 md:pb-8",
            isGmbSuite
              ? "gmb-suite min-h-[calc(100vh-4rem)] w-full"
              : "mx-auto max-w-7xl",
          )}
        >
          {children}
        </main>
      </div>

      <BottomNav items={bottomItems} activeHref={activeHref} />
    </div>
  );
}
