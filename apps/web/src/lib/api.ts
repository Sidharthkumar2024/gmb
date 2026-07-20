import type {
  ApiResponse,
  AuthTokens,
  AuthUserPublic,
} from "@nexaflow/shared";
import { resolveApiBase } from "./apiBase";

export const API_BASE = resolveApiBase();

const ACCESS_KEY = "nx_access";
const REFRESH_KEY = "nx_refresh";
// During an impersonation session, the SuperAdmin's original tokens
// are parked in these slots so the "Return to admin" button can swap
// them back without re-login.
const STASHED_ACCESS_KEY = "nx_admin_access";
const STASHED_REFRESH_KEY = "nx_admin_refresh";

export const tokenStore = {
  getAccess(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  getRefresh(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  set(tokens: AuthTokens): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
  /**
   * Park the current access/refresh pair under "admin" slots and load
   * the impersonation access token into the primary slot. Refresh is
   * NOT replaced — the impersonation access is short-lived (15 min,
   * same as a normal access) and not refreshable.
   */
  stashAdminAndSetImpersonation(impersonationAccessToken: string): void {
    if (typeof window === "undefined") return;
    const currentAccess = window.localStorage.getItem(ACCESS_KEY);
    const currentRefresh = window.localStorage.getItem(REFRESH_KEY);
    if (currentAccess) {
      window.localStorage.setItem(STASHED_ACCESS_KEY, currentAccess);
    }
    if (currentRefresh) {
      window.localStorage.setItem(STASHED_REFRESH_KEY, currentRefresh);
    }
    window.localStorage.setItem(ACCESS_KEY, impersonationAccessToken);
    // Refresh slot intentionally left as the admin's — if the
    // impersonation token expires mid-session, the next refresh
    // restores the admin context (which is the right safe default).
  },
  /**
   * Restore the parked admin tokens to the primary slots. No-op when
   * no stash is present.
   */
  restoreAdminFromStash(): boolean {
    if (typeof window === "undefined") return false;
    const stashedAccess = window.localStorage.getItem(STASHED_ACCESS_KEY);
    const stashedRefresh = window.localStorage.getItem(STASHED_REFRESH_KEY);
    if (!stashedAccess && !stashedRefresh) return false;
    if (stashedAccess) {
      window.localStorage.setItem(ACCESS_KEY, stashedAccess);
      window.localStorage.removeItem(STASHED_ACCESS_KEY);
    }
    if (stashedRefresh) {
      window.localStorage.setItem(REFRESH_KEY, stashedRefresh);
      window.localStorage.removeItem(STASHED_REFRESH_KEY);
    }
    return true;
  },
};

export class ApiClientError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

interface FetchOpts extends RequestInit {
  auth?: boolean;
  json?: unknown;
}

async function request<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers ?? {});
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (opts.auth !== false) {
    const token = tokenStore.getAccess();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });

  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as ApiResponse<T>) : null;

  if (!res.ok || !parsed?.success) {
    const code = parsed?.error?.code ?? "UNKNOWN";
    const message = parsed?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiClientError(code, res.status, message);
  }
  return parsed.data as T;
}

export const api = {
  get: <T>(path: string, opts: FetchOpts = {}) =>
    request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts: FetchOpts = {}) =>
    request<T>(path, { ...opts, method: "POST", json: body }),
  put: <T>(path: string, body?: unknown, opts: FetchOpts = {}) =>
    request<T>(path, { ...opts, method: "PUT", json: body }),
  patch: <T>(path: string, body?: unknown, opts: FetchOpts = {}) =>
    request<T>(path, { ...opts, method: "PATCH", json: body }),
  delete: <T>(path: string, opts: FetchOpts = {}) =>
    request<T>(path, { ...opts, method: "DELETE" }),
};

// ----------------------------------------------------------------------------
// Auth helpers
// ----------------------------------------------------------------------------

export interface LoginResult extends AuthTokens {
  user: AuthUserPublic;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const data = await api.post<LoginResult>(
    "/api/v1/auth/login",
    { email, password },
    { auth: false },
  );
  tokenStore.set(data);
  return data;
}

export async function signup(payload: {
  email: string;
  password: string;
  name: string;
  companyName: string;
  selectedPlanName?: string;
}): Promise<{
  user: AuthUserPublic;
  selectedPlan?: {
    id: string;
    name: string;
    displayName: string;
  } | null;
  message: string;
}> {
  return api.post<{
    user: AuthUserPublic;
    selectedPlan?: {
      id: string;
      name: string;
      displayName: string;
    } | null;
    message: string;
  }>(
    "/api/v1/auth/signup",
    payload,
    { auth: false },
  );
}

export async function logout(): Promise<void> {
  const refreshToken = tokenStore.getRefresh();
  try {
    await api.post("/api/v1/auth/logout", { refreshToken });
  } catch {
    // ignore — clearing locally is the important part
  }
  tokenStore.clear();
  // Defensive: wipe per-user draft autosaves so the next user doesn't see them.
  try {
    const { clearAllAutoSave } = await import("../hooks/useAutoSave");
    clearAllAutoSave();
  } catch {
    // ignore
  }
}

export interface MeResponse {
  user: AuthUserPublic;
  features?: Record<string, boolean>;
  products?: Record<string, boolean>;
  productAccess?: ProductAccessItem[];
}

export interface ProductAddOnAccess {
  key: string;
  name: string;
  description: string | null;
  priceInPaisa: number;
  billingCycle: string;
  isActive: boolean;
}

export interface ProductAccessItem {
  key: string;
  name: string;
  category: string;
  description?: string | null;
  routeHref: string | null;
  featureKey: string | null;
  icon?: string | null;
  enabled: boolean;
  limits?: unknown | null;
  source?: string;
  disabledReason?: string | null;
  addOns?: ProductAddOnAccess[];
}

export interface CustomerProductAccessResponse {
  products: ProductAccessItem[];
  productsByKey: Record<string, boolean>;
  features: Record<string, boolean>;
  terminology: {
    public: string;
    internal: string;
  };
}

export async function fetchMe(): Promise<AuthUserPublic | null> {
  try {
    const { user } = await api.get<MeResponse>("/api/v1/auth/me");
    return user;
  } catch {
    return null;
  }
}

export async function fetchMeFull(): Promise<MeResponse | null> {
  try {
    return await api.get<MeResponse>("/api/v1/auth/me");
  } catch {
    return null;
  }
}

export async function fetchCustomerProductAccess(): Promise<CustomerProductAccessResponse | null> {
  try {
    return await api.get<CustomerProductAccessResponse>(
      "/api/v1/products/customer-access",
    );
  } catch {
    return null;
  }
}

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  direction: "LTR" | "RTL";
  isLaunchLanguage: boolean;
}

export interface TenantLanguageSettings {
  setting: {
    tenantId: string;
    languageCode: string;
    locale: string;
    direction: "LTR" | "RTL";
    allowAutoTranslate: boolean;
    requireApprovalForSensitive: boolean;
    canUpdatePreference: boolean;
  };
  policy: {
    source: "customer" | "partner" | "platform";
    defaultLanguageCode: string;
    allowedLanguages: string[];
    allowCustomerOverride: boolean;
  };
  languages: LanguageOption[];
}

export async function fetchLanguageSettings(): Promise<TenantLanguageSettings> {
  return api.get<TenantLanguageSettings>("/api/v1/language-settings");
}

export async function updateLanguagePreference(
  languageCode: string,
  locale?: string,
): Promise<TenantLanguageSettings> {
  return api.patch<TenantLanguageSettings>("/api/v1/language-settings", {
    languageCode,
    locale,
  });
}

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
  minorUnit: number;
  isLaunchCurrency: boolean;
}

export interface TenantCurrencySettings {
  setting: {
    tenantId: string;
    currencyCode: string;
    locale: string;
    symbol: string;
    minorUnit: number;
    showConvertedAmounts: boolean;
    canUpdatePreference: boolean;
  };
  policy: {
    source: "customer" | "partner" | "platform";
    defaultCurrencyCode: string;
    settlementCurrencyCode: string;
    allowedCurrencies: string[];
    passThroughCustomerCurrency: boolean;
  };
  currencies: CurrencyOption[];
}

export async function fetchCurrencySettings(): Promise<TenantCurrencySettings> {
  return api.get<TenantCurrencySettings>("/api/v1/currency-settings");
}

export async function updateCurrencyPreference(
  currencyCode: string,
  locale?: string,
): Promise<TenantCurrencySettings> {
  return api.patch<TenantCurrencySettings>("/api/v1/currency-settings", {
    currencyCode,
    locale,
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await api.post(
    "/api/v1/auth/request-password-reset",
    { email },
    { auth: false },
  );
}

export async function resendVerification(email: string): Promise<{ message: string }> {
  return api.post<{ message: string }>(
    "/api/v1/auth/resend-verification",
    { email },
    { auth: false },
  );
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post(
    "/api/v1/auth/reset-password",
    { token, newPassword },
    { auth: false },
  );
}

export async function verifyEmail(token: string): Promise<void> {
  await api.post("/api/v1/auth/verify-email", { token }, { auth: false });
}

// ----------------------------------------------------------------------------
// Impersonation helpers
// ----------------------------------------------------------------------------

export interface ImpersonationStartResult {
  accessToken: string;
  expiresInSeconds: number;
  target: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  tenant: { id: string; name: string };
}

/**
 * SUPER_ADMIN flow: mint an impersonation access token, stash the
 * admin's original tokens so the banner's "Return to admin" can swap
 * back, then load the impersonation token into the primary slot.
 */
export async function startImpersonation(args: {
  targetTenantId: string;
  targetUserId?: string;
  reason?: string;
}): Promise<ImpersonationStartResult> {
  const result = await api.post<ImpersonationStartResult>(
    "/api/v1/admin/impersonate/start",
    args,
  );
  tokenStore.stashAdminAndSetImpersonation(result.accessToken);
  return result;
}

/**
 * Best-effort exit. POSTs /exit so the audit trail records the close,
 * then restores the parked admin tokens. The server-side audit row is
 * non-critical to user flow — if the POST fails (network, expired
 * token), we still swap the tokens locally so the operator regains
 * their admin context.
 */
export async function exitImpersonation(): Promise<void> {
  try {
    await api.post("/api/v1/admin/impersonate/exit");
  } catch {
    // Swallow — audit row is best-effort; the swap below is what
    // matters for the operator.
  }
  tokenStore.restoreAdminFromStash();
}
