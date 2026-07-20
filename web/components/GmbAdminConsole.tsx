"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  CreditCard,
  KeyRound,
  Receipt,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const GMB_ADMIN_ITEMS: Array<{
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  aliases?: string[];
}> = [
  {
    href: "/partner-overview",
    label: "Partners",
    description: "Partner wallets and GMB footprint",
    icon: Store,
  },
  {
    href: "/gmb-admin/customers",
    label: "Customers",
    description: "Customer tenants and account status",
    icon: Users,
    aliases: ["/tenants"],
  },
  {
    href: "/payments",
    label: "Transactions",
    description: "Recharge orders and gateway webhooks",
    icon: CreditCard,
  },
  {
    href: "/gmb-admin/invoices",
    label: "Transaction Invoice",
    description: "Paid invoices from wallet recharges",
    icon: Receipt,
  },
  {
    href: "/gmb-admin/api-key",
    label: "Setup API Key",
    description: "Public API keys and usage logs",
    icon: KeyRound,
    aliases: ["/developer"],
  },
];

export function GmbAdminConsole({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            {title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <Link href="/dashboard" className="font-medium text-slate-700 hover:text-slate-950">
              Dashboard
            </Link>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span className="font-medium text-slate-700">Google My Business</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>{title}</span>
          </div>
          {description && (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[290px,1fr]">
        <aside className="h-fit rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="mb-2 flex items-center gap-3 rounded-lg bg-blue-50 px-3 py-3 text-blue-700">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-sm font-black text-white shadow-sm">
              G
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">Google My Business</div>
              <div className="text-xs text-blue-600/75">Admin controls</div>
            </div>
          </div>
          <nav className="space-y-1">
            {GMB_ADMIN_ITEMS.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`) ||
                item.aliases?.some(
                  (alias) => pathname === alias || pathname.startsWith(`${alias}/`),
                );
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg px-3 py-3 transition",
                    active
                      ? "bg-slate-950 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 h-4 w-4 flex-none",
                      active ? "text-blue-300" : "text-slate-400 group-hover:text-blue-600",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span
                      className={cn(
                        "mt-0.5 block text-xs leading-4",
                        active ? "text-slate-300" : "text-slate-400",
                      )}
                    >
                      {item.description}
                    </span>
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
