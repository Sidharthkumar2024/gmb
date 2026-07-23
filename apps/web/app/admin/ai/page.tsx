"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// AI models — the platform provider registry backing text + image generation.
//
// Keys are stored encrypted in the Secret Vault; this page only ever sees
// last-4 masks. Text generation walks ANTHROPIC entries (the only text SDK in
// this build) with the env ANTHROPIC_API_KEY as fallback; image generation
// walks the IMAGE chain. Other providers can be registered but are not yet
// callable — the form says so instead of pretending.

interface ProviderRow {
  id: string;
  provider: string;
  kind: string;
  label: string;
  secretId: string | null;
  hasKey: boolean;
  defaultModel: string | null;
  baseUrl: string | null;
  priority: number;
  isDefault: boolean;
  status: "ACTIVE" | "DISABLED";
}

interface AiData {
  env: { anthropicConfigured: boolean; model: string };
  providers: ProviderRow[];
  secrets: Array<{ id: string; provider: string; label: string; last4: string | null }>;
}

const PROVIDERS = ["ANTHROPIC", "OPENAI", "GEMINI", "DEEPSEEK", "GROK", "REPLICATE", "CUSTOM"];
const KINDS = ["TEXT", "IMAGE"];
// What the API can actually execute today; everything else is registry-only.
const CALLABLE = new Set(["ANTHROPIC:TEXT", "OPENAI:IMAGE", "REPLICATE:IMAGE"]);

const inputCls =
  "rounded-control border border-adm-line bg-adm-bg px-3 py-2 text-sm2 text-adm-ink outline-none placeholder:text-adm-subtle focus:border-gmb-brand";

export default function AdminAiPage() {
  const [data, setData] = useState<AiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Add-provider form
  const [provider, setProvider] = useState("ANTHROPIC");
  const [kind, setKind] = useState("TEXT");
  const [label, setLabel] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<AiData>("/api/v1/admin/ai"));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load AI settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "The change did not apply.");
    } finally {
      setBusy(null);
    }
  }

  async function addProvider(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/v1/admin/ai/providers", {
        provider,
        kind,
        label: label.trim(),
        ...(model.trim() ? { defaultModel: model.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setLabel("");
      setModel("");
      setApiKey("");
      await load();
    } catch (e2) {
      setError(e2 instanceof ApiClientError ? e2.message : "Could not add the provider.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell title="AI models">
      {error && (
        <div className="mb-3.5 rounded-control border border-gmb-danger/30 bg-gmb-danger/10 px-3 py-2 text-sm2 text-[#ff8f85]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5">
        <AdmCard>
          <div className="flex items-center justify-between">
            <AdmLabel>Env fallback</AdmLabel>
            <AdmPill tone={data ? (data.env.anthropicConfigured ? "ok" : "warn") : "neutral"}>
              {data ? (data.env.anthropicConfigured ? "ANTHROPIC_API_KEY set" : "Not set") : "—"}
            </AdmPill>
          </div>
          <div className="mt-2 font-geist-mono text-xs2 text-adm-muted">
            {data ? data.env.model : "—"}
          </div>
          <div className="mt-1 text-xs2 text-adm-muted">
            Used when no registry entry below can serve a call. Registered keys always win over the
            env key.
          </div>
        </AdmCard>

        <AdmCard>
          <AdmLabel>How resolution works</AdmLabel>
          <div className="mt-2 text-xs2 leading-relaxed text-adm-muted">
            Text calls walk ACTIVE <span className="text-adm-ink">ANTHROPIC · TEXT</span> entries
            (default first, then by priority); image calls walk the IMAGE chain. Other providers are
            stored for later but not yet callable. Keys live encrypted in the vault — only the last
            4 characters are ever shown.
          </div>
        </AdmCard>
      </div>

      <div className="mt-3.5">
        <div className="mb-2 flex items-center gap-2">
          <AdmLabel>Registered providers</AdmLabel>
        </div>
        {data === null ? (
          <AdmCard>
            <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
          </AdmCard>
        ) : data.providers.length === 0 ? (
          <AdmCard>
            <div className="py-8 text-center text-sm2 text-adm-muted">
              No providers registered — AI runs on the env fallback key (if set).
            </div>
          </AdmCard>
        ) : (
          <AdmCard className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-adm-line">
                  {["Provider", "Model", "Key", "Priority", "Status", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 font-geist-mono text-micro font-medium uppercase tracking-[0.1em] text-adm-subtle"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.providers.map((p) => {
                  const secret = data.secrets.find((s) => s.id === p.secretId);
                  return (
                    <tr key={p.id} className="border-b border-adm-line/60 last:border-0 hover:bg-adm-panel-hover">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-adm-ink">{p.label}</span>
                          {p.isDefault && <AdmPill tone="brand">default</AdmPill>}
                          {!CALLABLE.has(`${p.provider}:${p.kind}`) && (
                            <AdmPill tone="warn">not callable yet</AdmPill>
                          )}
                        </div>
                        <div className="font-geist-mono text-micro text-adm-subtle">
                          {p.provider} · {p.kind}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">
                        {p.defaultModel ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">
                        {p.hasKey ? `••••${secret?.last4 ?? ""}` : "env / none"}
                      </td>
                      <td className="px-4 py-3 font-geist-mono text-xs2 text-adm-muted">{p.priority}</td>
                      <td className="px-4 py-3">
                        <AdmPill tone={p.status === "ACTIVE" ? "ok" : "neutral"}>{p.status}</AdmPill>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          {!p.isDefault && p.status === "ACTIVE" && (
                            <button
                              type="button"
                              disabled={busy === p.id}
                              onClick={() =>
                                void run(p.id, () => api.post(`/api/v1/admin/ai/providers/${p.id}/default`, {}))
                              }
                              className="rounded-control border border-adm-line px-2.5 py-1.5 text-xs2 font-medium text-adm-accent hover:bg-gmb-brand/10 disabled:opacity-50"
                            >
                              Make default
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() =>
                              void run(p.id, () =>
                                api.patch(`/api/v1/admin/ai/providers/${p.id}`, {
                                  status: p.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                                }),
                              )
                            }
                            className="rounded-control border border-adm-line px-2.5 py-1.5 text-xs2 font-medium text-adm-muted hover:bg-adm-panel-hover disabled:opacity-50"
                          >
                            {p.status === "ACTIVE" ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() => {
                              if (!window.confirm(`Delete "${p.label}"? Its stored key is deleted with it.`)) return;
                              void run(p.id, () => api.delete(`/api/v1/admin/ai/providers/${p.id}`));
                            }}
                            className="rounded-control border border-adm-line px-2.5 py-1.5 text-xs2 font-medium text-[#ff8f85] hover:bg-gmb-danger/10 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdmCard>
        )}
      </div>

      <div className="mt-3.5">
        <div className="mb-2 flex items-center gap-2">
          <AdmLabel>Add provider</AdmLabel>
        </div>
        <AdmCard>
          <form onSubmit={addProvider} className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">Provider</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                    {CALLABLE.has(`${p}:${kind}`) ? "" : " (stored, not callable yet)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">Kind</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">Label</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Production Claude"
                required
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">
                Model (optional)
              </span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-sonnet-5"
                className={inputCls}
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">
                API key (optional — stored encrypted, shown as last 4 only)
              </span>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type="password"
                autoComplete="off"
                placeholder="sk-…"
                className={inputCls}
              />
            </label>
            <div className="col-span-2 flex items-center justify-between">
              <span className="text-xs2 text-adm-muted">
                Without a key the entry resolves nothing; text calls then use the env fallback.
              </span>
              <button
                type="submit"
                disabled={saving || !label.trim()}
                className="rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white hover:bg-gmb-brand-hover disabled:opacity-50"
              >
                {saving ? "Adding…" : "Add provider"}
              </button>
            </div>
          </form>
        </AdmCard>
      </div>
    </AdminShell>
  );
}
