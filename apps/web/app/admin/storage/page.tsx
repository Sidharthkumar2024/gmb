"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Object storage (S3 / Cloudflare R2) — platform config for image uploads.
//
// The secret access key is stored encrypted in the Secret Vault and never comes
// back to the browser (last-4 mask only), same rule as SMTP and AI keys. Until
// this is configured, upload endpoints fail closed with 503.

type StorageView =
  | { configured: false }
  | {
      configured: true;
      provider: "S3" | "R2";
      bucket: string;
      region: string;
      endpoint: string | null;
      publicBaseUrl: string | null;
      accessKeyIdLast4: string;
      secretKeyLast4: string | null;
    };

const inputCls =
  "rounded-control border border-adm-line bg-adm-bg px-3 py-2 text-sm2 text-adm-ink outline-none placeholder:text-adm-subtle focus:border-gmb-brand";

export default function AdminStoragePage() {
  const [data, setData] = useState<StorageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [provider, setProvider] = useState<"S3" | "R2">("S3");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.get<StorageView>("/api/v1/admin/storage");
      setData(d);
      if (d.configured) {
        setProvider(d.provider);
        setBucket(d.bucket);
        setRegion(d.region);
        setEndpoint(d.endpoint ?? "");
        setPublicBaseUrl(d.publicBaseUrl ?? "");
        setAccessKeyId(""); // re-enter on change; we only show the last-4
      }
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load storage settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.put("/api/v1/admin/storage", {
        provider,
        bucket: bucket.trim(),
        region: region.trim(),
        ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
        ...(publicBaseUrl.trim() ? { publicBaseUrl: publicBaseUrl.trim() } : {}),
        accessKeyId: accessKeyId.trim(),
        ...(secretAccessKey ? { secretAccessKey } : {}),
      });
      setSecretAccessKey("");
      setNotice("Storage settings saved. New uploads use them immediately.");
      await load();
    } catch (e2) {
      setError(e2 instanceof ApiClientError ? e2.message : "Could not save storage settings.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete the saved storage settings? Uploads turn off until reconfigured.")) return;
    setError(null);
    setNotice(null);
    try {
      await api.delete("/api/v1/admin/storage");
      setBucket("");
      setRegion("");
      setEndpoint("");
      setPublicBaseUrl("");
      setAccessKeyId("");
      setSecretAccessKey("");
      setNotice("Saved storage settings deleted.");
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not delete the settings.");
    }
  }

  const configured = data?.configured === true;

  return (
    <AdminShell title="Image storage">
      {error && (
        <div className="mb-4 rounded-control border border-gmb-danger/40 bg-gmb-danger/10 px-4 py-3 text-sm2 text-gmb-danger">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-control border border-gmb-ok/40 bg-gmb-ok/10 px-4 py-3 text-sm2 text-gmb-ok">
          {notice}
        </div>
      )}

      <AdmCard>
        <div className="mb-4 flex items-center justify-between">
          <AdmLabel>S3 / R2 credentials</AdmLabel>
          <AdmPill tone={configured ? "ok" : "neutral"}>
            {configured ? "Configured" : "Not configured"}
          </AdmPill>
        </div>

        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm2 text-adm-subtle">Provider</span>
            <select
              className={inputCls}
              value={provider}
              onChange={(e) => setProvider(e.target.value as "S3" | "R2")}
            >
              <option value="S3">Amazon S3</option>
              <option value="R2">Cloudflare R2</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm2 text-adm-subtle">Region</span>
            <input className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1 / auto" required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm2 text-adm-subtle">Bucket</span>
            <input className={inputCls} value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="my-media-bucket" required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm2 text-adm-subtle">
              Endpoint {provider === "R2" ? "(required for R2)" : "(optional)"}
            </span>
            <input className={inputCls} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="acct.r2.cloudflarestorage.com" />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-sm2 text-adm-subtle">Public base URL (optional — CDN / public bucket)</span>
            <input className={inputCls} value={publicBaseUrl} onChange={(e) => setPublicBaseUrl(e.target.value)} placeholder="https://cdn.example.com" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm2 text-adm-subtle">Access key ID</span>
            <input className={inputCls} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} placeholder="AKIA…" required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm2 text-adm-subtle">
              Secret access key{" "}
              {configured && data.secretKeyLast4 ? (
                <span className="text-adm-subtle">· stored ••••{data.secretKeyLast4}</span>
              ) : null}
            </span>
            <input
              className={inputCls}
              type="password"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              placeholder={configured ? "leave blank to keep current" : "secret access key"}
            />
          </label>

          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            {configured && (
              <button type="button" onClick={remove} className="text-sm2 text-gmb-danger hover:underline">
                Delete
              </button>
            )}
          </div>
        </form>

        <p className="mt-4 text-sm2 leading-relaxed text-adm-subtle">
          The secret key is encrypted in the Secret Vault and never returned to the browser — only the last 4
          are shown. Uploads (branding logos, GMB images) use a short-lived presigned URL signed server-side.
        </p>
      </AdmCard>
    </AdminShell>
  );
}
