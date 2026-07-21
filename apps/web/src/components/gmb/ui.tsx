"use client";

import type { ReactNode } from "react";

// Primitives shared by the GMB Suite screens, matching the design file so no
// screen hardcodes a hex or a radius.

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-card border border-gmb-line bg-gmb-surface ${padded ? "p-5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-gmb-ink-subtle">
      {children}
    </div>
  );
}

/** Headline number with a caption, as used across the dashboard tiles. */
export function Stat({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: "ok" | "warn" | "danger";
}) {
  const toneClass =
    tone === "ok"
      ? "text-gmb-ok"
      : tone === "warn"
        ? "text-gmb-warn"
        : tone === "danger"
          ? "text-gmb-danger"
          : "text-gmb-ink";
  return (
    <Card>
      <SectionLabel>{label}</SectionLabel>
      <div className={`mt-1.5 text-[28px] font-bold tracking-[-0.02em] ${toneClass}`}>{value}</div>
      {caption ? <div className="mt-1 text-xs2 text-gmb-ink-muted">{caption}</div> : null}
    </Card>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "brand";
}) {
  const map = {
    neutral: "bg-gmb-line-soft text-gmb-ink-muted",
    ok: "bg-gmb-ok-bg text-gmb-ok",
    warn: "bg-gmb-warn-bg text-gmb-warn",
    danger: "bg-gmb-danger-bg text-gmb-danger",
    brand: "bg-gmb-brand-tint text-gmb-brand",
  } as const;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-tiny font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "dark" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const map = {
    primary: "bg-gmb-brand text-white hover:bg-gmb-brand-hover",
    dark: "bg-gmb-night text-white hover:bg-gmb-night-soft",
    ghost: "border border-gmb-line bg-gmb-surface text-gmb-ink hover:border-gmb-brand-border",
    danger: "bg-gmb-danger text-white hover:opacity-90",
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-control px-4 py-2 text-sm2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${map[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Shown when a list is legitimately empty — never used to mask an error. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Card className="text-center">
      <div className="py-6">
        <div className="text-[15px] font-semibold text-gmb-ink">{title}</div>
        <div className="mx-auto mt-1.5 max-w-md text-sm2 text-gmb-ink-muted">{body}</div>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </Card>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-control border border-gmb-danger/30 bg-gmb-danger-bg px-3 py-2 text-sm2 text-gmb-danger">
      {children}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gmb-line-soft ${className}`} />;
}
