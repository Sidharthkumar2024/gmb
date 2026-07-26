"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Payment gateways — which provider handles credit top-ups. Keys live in the
// server env per provider (safest for payment secrets); this screen reports
// configured-status and lets an admin pick the active one. Crediting always
// flows through the same idempotent ledger regardless of provider.

interface Provider {
  provider: "razorpay" | "stripe";
  configured: boolean;
  active: boolean;
  priceLabel: string;
}
interface GatewayStatus {
  activeProvider: string;
  providers: Provider[];
}

const ENV_HINT: Record<string, string> = {
  razorpay: "RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET",
  stripe: "STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET",
};
const NAME: Record<string, string> = { razorpay: "Razorpay", stripe: "Stripe" };

export default function AdminGatewaysPage() {
  const [data, setData] = useState<GatewayStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<GatewayStatus>("/api/v1/admin/gateways"));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load gateways.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate(provider: string) {
    setBusy(provider);
    setError(null);
    setNotice(null);
    try {
      setData(await api.put<GatewayStatus>("/api/v1/admin/gateways", { activeProvider: provider }));
      setNotice(`${NAME[provider]} is now the active gateway for top-ups.`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not switch gateway.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Payment gateways">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3.5 rounded-control border border-adm-ok/30 bg-adm-ok/10 px-3 py-2 text-sm2 text-adm-ok">
          {notice}
        </div>
      )}

      <div className="mb-3.5 flex items-center gap-2">
        <AdmLabel>How it works</AdmLabel>
        <span className="text-xs2 text-adm-muted">
          Credit top-ups run through the active gateway. Keys are read from the server env; only the
          active choice is set here. A provider can&rsquo;t be made active until its keys are present.
        </span>
      </div>

      {data === null ? (
        <AdmCard>
          <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        </AdmCard>
      ) : (
        <div className="grid grid-cols-2 gap-3.5">
          {data.providers.map((p) => (
            <AdmCard key={p.provider}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-adm-ink">{NAME[p.provider]}</span>
                    {p.active && <AdmPill tone="brand">Active</AdmPill>}
                  </div>
                  <div className="mt-1 font-geist-mono text-micro text-adm-subtle">{p.priceLabel}</div>
                </div>
                <AdmPill tone={p.configured ? "ok" : "warn"}>
                  {p.configured ? "Configured" : "Keys not set"}
                </AdmPill>
              </div>

              <div className="mt-3 border-t border-adm-line pt-3">
                <div className="font-geist-mono text-micro text-adm-subtle">
                  env: {ENV_HINT[p.provider]}
                </div>
                <div className="mt-3">
                  {p.active ? (
                    <span className="text-xs2 text-adm-muted">Handling top-ups now.</span>
                  ) : (
                    <button
                      type="button"
                      disabled={!p.configured || busy === p.provider}
                      onClick={() => void activate(p.provider)}
                      title={p.configured ? "" : "Set this provider's env keys first"}
                      className="rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white hover:bg-gmb-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === p.provider ? "Switching…" : "Make active"}
                    </button>
                  )}
                </div>
              </div>
            </AdmCard>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
