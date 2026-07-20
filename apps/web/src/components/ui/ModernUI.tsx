"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Modern Stat Card with gradient backgrounds
export function ModernStatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
  gradient = "from-blue-500 to-purple-600",
  className,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  gradient?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-white p-6 shadow-soft transition-all duration-300 hover:shadow-medium animate-fade-in",
        className
      )}
    >
      {/* Gradient background accent */}
      <div
        className={cn(
          "absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-10 blur-2xl",
          gradient.replace("from-", "bg-").split(" ")[0]
        )}
      />

      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">{title}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
            {subtitle && (
              <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
            )}
          </div>
          <div
            className={cn(
              "inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg",
              gradient
            )}
          >
            {icon}
          </div>
        </div>

        {trend && trendValue && (
          <div className="mt-4 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold",
                trend === "up"
                  ? "bg-emerald-50 text-emerald-700"
                  : trend === "down"
                  ? "bg-rose-50 text-rose-700"
                  : "bg-slate-100 text-slate-600"
              )}
            >
              {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"} {trendValue}
            </span>
            <span className="text-xs text-slate-500">vs last period</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Modern Action Card
export function ModernActionCard({
  title,
  description,
  icon,
  href,
  badge,
  onClick,
  className,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  href?: string;
  badge?: string;
  onClick?: () => void;
  className?: string;
}) {
  const Component = href ? "a" : "button";

  return (
    <Component
      href={href}
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-soft transition-all duration-300 hover:border-primary-300 hover:shadow-medium animate-scale-in",
        onClick && "cursor-pointer",
        className
      )}
    >
      <div className="flex items-start gap-4">
        <div className="inline-flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-accent-purple text-white shadow-lg transition-transform duration-300 group-hover:scale-110">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {badge && (
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-700">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
      </div>

      {/* Hover effect */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary-50/50 to-accent-purple/50 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
    </Component>
  );
}

// Modern Badge Component
export function ModernBadge({
  children,
  variant = "default",
  size = "md",
  className,
}: {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info" | "purple";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const variants = {
    default: "bg-slate-100 text-slate-700 border-slate-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    error: "bg-rose-50 text-rose-700 border-rose-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
  };

  const sizes = {
    sm: "px-2 py-0.5 text-[10px]",
    md: "px-2.5 py-1 text-xs",
    lg: "px-3 py-1.5 text-sm",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold border",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </span>
  );
}

// Modern Button Component
export function ModernButton({
  children,
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled = false,
  onClick,
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "gradient";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const variants = {
    primary:
      "bg-slate-900 text-white hover:bg-slate-800 shadow-soft hover:shadow-medium",
    secondary:
      "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-soft",
    outline:
      "bg-transparent text-slate-900 border-2 border-slate-900 hover:bg-slate-50",
    ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
    gradient:
      "bg-gradient-to-r from-primary-600 to-accent-purple text-white hover:from-primary-700 hover:to-accent-purple/90 shadow-lg hover:shadow-glow-primary",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {loading ? (
        <svg
          className="h-4 w-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

// Modern Progress Bar
export function ModernProgressBar({
  value,
  max = 100,
  label,
  color = "primary",
  showPercentage = true,
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  color?: "primary" | "success" | "warning" | "error";
  showPercentage?: boolean;
  className?: string;
}) {
  const percentage = Math.min((value / max) * 100, 100);

  const colors = {
    primary: "from-primary-500 to-primary-600",
    success: "from-emerald-500 to-emerald-600",
    warning: "from-amber-500 to-amber-600",
    error: "from-rose-500 to-rose-600",
  };

  return (
    <div className={cn("space-y-2", className)}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-sm font-medium text-slate-700">{label}</span>}
          {showPercentage && (
            <span className="text-sm font-semibold text-slate-900">
              {percentage.toFixed(0)}%
            </span>
          )}
        </div>
      )}
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full bg-gradient-to-r transition-all duration-500 ease-out",
            colors[color]
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// Modern Alert/Notification Card
export function ModernAlert({
  title,
  message,
  type = "info",
  icon,
  action,
  className,
}: {
  title: string;
  message?: string;
  type?: "info" | "success" | "warning" | "error";
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const types = {
    info: "bg-blue-50 border-blue-200 text-blue-900",
    success: "bg-emerald-50 border-emerald-200 text-emerald-900",
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    error: "bg-rose-50 border-rose-200 text-rose-900",
  };

  const icons = {
    info: "ℹ️",
    success: "✓",
    warning: "⚠",
    error: "✕",
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-4 animate-slide-down",
        types[type],
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 text-xl">{icon || icons[type]}</div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold">{title}</h4>
          {message && <p className="mt-1 text-sm opacity-90">{message}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  );
}
