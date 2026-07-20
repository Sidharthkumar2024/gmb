"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUserPublic, UserRole } from "@nexaflow/shared";
import { fetchMeFull, logout, tokenStore } from "../lib/api";

type RoleName =
  | "SUPER_ADMIN"
  | "WHITE_LABEL_ADMIN"
  | "BUSINESS_ADMIN"
  | "TEAM_LEAD"
  | "AGENT";

export function useAuth(opts: { required?: boolean; roles?: RoleName[] } = {}) {
  const router = useRouter();
  const required = opts.required;
  const roles = opts.roles;
  const rolesKey = roles?.join(",");
  const [user, setUser] = useState<AuthUserPublic | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [products, setProducts] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const access = tokenStore.getAccess();
    if (!access) {
      setLoading(false);
      if (required) router.replace("/login");
      return;
    }
    (async () => {
      const me = await fetchMeFull();
      if (cancelled) return;
      if (!me) {
        tokenStore.clear();
        setLoading(false);
        if (required) router.replace("/login");
        return;
      }
      if (roles && !roles.includes(me.user.role as RoleName)) {
        setLoading(false);
        router.replace(roleHome(me.user.role));
        return;
      }
      setUser(me.user);
      setFeatures(me.features ?? null);
      setProducts(me.products ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [required, rolesKey, router]);

  return {
    user,
    features,
    products,
    loading,
    signOut: () => logout().then(() => router.push("/login")),
  };
}

/**
 * Landing route after sign-in. This app is GMB-only, so every role lands on the
 * Local SEO dashboard — the monorepo's /dashboard, /partner/dashboard and
 * /agent/home do not exist here, and returning them would 404 on login.
 */
export function roleHome(_role: UserRole): string {
  return "/gmb-dashboard";
}
