"use client";

import { useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, API_BASE, ApiClientError } from "../../../src/lib/api";

// Partner payment gateway. The partner stores its OWN Razorpay / Stripe keys
// (in the PARTNER-scope vault, only a last-4 ever comes back). Live charge
// routing to the partner's gateway turns on with commission billing — the page
// says so plainly rather than implying customers are already charged here.

type Provider = "razorpay" | "stripe";
interface ProviderStatus {
  provider: Provider;
  configured: boolean;
  webhookConfigured: boolean;
  ready: boolean;
  active: boolean;
  last4: string | null;
  keyIdLast4: string | null;
}
interface GatewayStatus {
  partnerTenantId: string;
  activeProvider: Provider | null;
  liveRoutingEnabled: boolean;
  providers: ProviderStatus[];
}

const META: Record<Provider, { name: string; secretLabel: string; needsKeyId: boolean; hint: string }> = {
  razorpay: {
    name: "Razorpay",
    secretLabel: "Key secret",
    needsKeyId: true,
    hint: "From Razorpay Dashboard → Settings → API Keys.",
  },
  stripe: {
    name: "Stripe",
    secretLabel: "Secret key (sk_live_…)",
    needsKeyId: false,
    hint: "From Stripe Dashboard → Developers → API keys.",
  },
};

export default function PartnerGatewayPage() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forms, setForms] = useState<
    Record<Provider, { keyId: string; secret: string; webhookSecret: string }>
  >({
    razorpay: { keyId: "", secret: "", webhookSecret: "" },
    stripe: { keyId: "", secret: "", webhookSecret: "" },
  });
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setStatus(await api.get<GatewayStatus>("/api/v1/partner/gateway"));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load gateway status.");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const saveKeys = async (provider: Provider) => {
    const f = forms[provider];
    setBusy(`save:${provider}`);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, string> = { provider, secret: f.secret };
      if (META[provider].needsKeyId) body.keyId = f.keyId;
      if (f.webhookSecret.trim()) body.webhookSecret = f.webhookSecret.trim();
      setStatus(await api.put<GatewayStatus>("/api/v1/partner/gateway/keys", body));
      setForms({ ...forms, [provider]: { keyId: "", secret: "", webhookSecret: "" } });
      setNotice(`${META[provider].name} keys saved.`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save keys.");
    } finally {
      setBusy(null);
    }
  };

  const makeActive = async (provider: Provider) => {
    setBusy(`active:${provider}`);
    setError(null);
    setNotice(null);
    try {
      setStatus(await api.put<GatewayStatus>("/api/v1/partner/gateway/active", { provider }));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not activate provider.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (provider: Provider) => {
    setBusy(`del:${provider}`);
    setError(null);
    setNotice(null);
    try {
      setStatus(await api.delete<GatewayStatus>(`/api/v1/partner/gateway/${provider}`));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not disconnect.");
    } finally {
      setBusy(null);
    }
  };

  // The webhook must reach the API, not the web app. Prefer the configured API
  // base; fall back to the current origin (same-origin/proxied deployments).
  const webhookOrigin =
    API_BASE || (typeof window !== "undefined" ? window.location.origin : "");

  const inputCls =
    "w-full rounded-control border border-ptn-line bg-ptn-bg px-3 py-2 font-geist-mono text-xs2 text-ptn-ink outline-none focus:border-ptn-accent";

  return (
    <PartnerShell title="Payment gateways">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-ptn-danger">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3.5 rounded-control border border-ptn-accent/30 bg-ptn-accent/10 px-3 py-2 text-sm2 text-ptn-accent">
          {notice}
        </div>
      )}

      <div className="mb-3.5 rounded-control border border-ptn-line bg-ptn-bg px-4 py-3 text-xs2 text-ptn-muted">
        Keys are stored encrypted — only the last 4 digits are ever shown.{" "}
        {status &&
          (status.liveRoutingEnabled ? (
            <span className="text-ptn-accent">
              Live: your customers&apos; top-ups are captured on your active gateway.
            </span>
          ) : (
            <span className="text-ptn-ink">
              Add both API keys and a webhook secret, then activate a provider to route your
              customers&apos; charges to your own gateway.
            </span>
          ))}
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {(status?.providers ?? []).map((p) => {
          const meta = META[p.provider];
          const f = forms[p.provider];
          return (
            <PtnCard key={p.provider}>
              <div className="flex items-center justify-between">
                <PtnLabel>{meta.name}</PtnLabel>
                {p.active ? (
                  <PtnPill tone={p.ready ? "ok" : "warn"}>{p.ready ? "Active" : "Active · needs webhook"}</PtnPill>
                ) : p.configured ? (
                  <PtnPill tone="neutral">Connected</PtnPill>
                ) : (
                  <PtnPill tone="warn">Not set up</PtnPill>
                )}
              </div>

              {p.configured ? (
                <div className="mt-3 space-y-1 text-xs2 text-ptn-muted">
                  {p.keyIdLast4 && (
                    <div>
                      Key id ····<span className="font-geist-mono text-ptn-ink">{p.keyIdLast4}</span>
                    </div>
                  )}
                  <div>
                    Secret ····<span className="font-geist-mono text-ptn-ink">{p.last4 ?? "••••"}</span>
                  </div>
                  <div>
                    Webhook{" "}
                    {p.webhookConfigured ? (
                      <span className="text-ptn-accent">configured</span>
                    ) : (
                      <span className="text-[#f0b264]">not set</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-xs2 text-ptn-subtle">{meta.hint}</div>
              )}

              {status && (
                <div className="mt-3 rounded-control border border-ptn-line bg-ptn-bg px-3 py-2">
                  <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-ptn-subtle">
                    Webhook URL — add this in your {meta.name} dashboard
                  </div>
                  <div className="mt-1 break-all font-geist-mono text-micro text-ptn-ink">
                    {webhookOrigin}/api/v1/billing/webhook/{p.provider}/{status.partnerTenantId}
                  </div>
                </div>
              )}

              <div className="mt-3 space-y-2">
                {meta.needsKeyId && (
                  <input
                    className={inputCls}
                    placeholder="Key id (rzp_live_…)"
                    value={f.keyId}
                    onChange={(e) =>
                      setForms({ ...forms, [p.provider]: { ...f, keyId: e.target.value } })
                    }
                  />
                )}
                <input
                  className={inputCls}
                  type="password"
                  placeholder={meta.secretLabel}
                  value={f.secret}
                  onChange={(e) =>
                    setForms({ ...forms, [p.provider]: { ...f, secret: e.target.value } })
                  }
                />
                <input
                  className={inputCls}
                  type="password"
                  placeholder="Webhook signing secret"
                  value={f.webhookSecret}
                  onChange={(e) =>
                    setForms({ ...forms, [p.provider]: { ...f, webhookSecret: e.target.value } })
                  }
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => saveKeys(p.provider)}
                  disabled={busy === `save:${p.provider}` || !f.secret}
                  className="rounded-control bg-ptn-accent px-3.5 py-1.5 text-xs2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover disabled:opacity-50"
                >
                  {busy === `save:${p.provider}` ? "Saving…" : p.configured ? "Update keys" : "Save keys"}
                </button>
                {p.configured && !p.active && (
                  <button
                    type="button"
                    onClick={() => makeActive(p.provider)}
                    disabled={busy === `active:${p.provider}`}
                    className="rounded-control border border-ptn-line px-3.5 py-1.5 text-xs2 font-medium text-ptn-ink hover:bg-ptn-panel-hover disabled:opacity-50"
                  >
                    Make active
                  </button>
                )}
                {p.configured && (
                  <button
                    type="button"
                    onClick={() => disconnect(p.provider)}
                    disabled={busy === `del:${p.provider}`}
                    className="rounded-control border border-ptn-line px-3.5 py-1.5 text-xs2 font-medium text-ptn-danger hover:bg-gmb-danger/10 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </PtnCard>
          );
        })}
      </div>
    </PartnerShell>
  );
}
