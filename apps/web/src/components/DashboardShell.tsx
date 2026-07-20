"use client";

import type { ReactNode } from "react";
import type { AuthUserPublic } from "@nexaflow/shared";
import { AppShell } from "./AppShell";

export function DashboardShell({
  user,
  features,
  products,
  signOut,
  children,
}: {
  user: AuthUserPublic;
  /** Per-tenant feature flags. Missing key or undefined means feature is on. */
  features?: Record<string, boolean> | null;
  /** Per-customer product access. Missing key or undefined means product is on. */
  products?: Record<string, boolean> | null;
  signOut: () => void;
  children: ReactNode;
}) {
  return (
    <AppShell user={user} features={features} products={products} signOut={signOut}>
      {children}
    </AppShell>
  );
}
