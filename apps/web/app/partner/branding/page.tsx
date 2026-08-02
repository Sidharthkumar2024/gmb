"use client";

// White-label — the partner's brand as their customers will see it: name,
// domain, color, logo, hide-powered-by. The live preview is a miniature of the
// customer dashboard rendered with these settings, so a partner sees exactly
// what changes before saving.
//
// DNS ownership is verified server-side by TXT or CNAME lookup. Domain purchase
// remains outside the product; this page handles the part the app can prove.

import { useCallback, useEffect, useState } from "react";
import { PartnerShell, PtnCard, PtnLabel, PtnPill } from "../../../src/components/gmb/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";
import { uploadFile } from "../../../src/lib/upload";

interface Branding {
  brandName: string | null;
  customDomain: string | null;
  domainVerified: boolean;
  domainVerificationToken: string | null;
  domainVerifiedAt: string | null;
  cnameTarget: string;
  brandColorHex: string;
  logoUrl: string | null;
  hidePoweredBy: boolean;
  senderName: string | null;
  senderEmail: string | null;
}

const SWATCHES = ["#5a4af0", "#7dd8a0", "#e3b558", "#e58c7f", "#4a90d9"];
const inputCls =
  "w-full rounded-control border border-ptn-line bg-ptn-bg px-3 py-2 text-sm2 text-ptn-ink outline-none placeholder:text-ptn-subtle focus:border-ptn-accent";

export default function PartnerBrandingPage() {
  const [saved, setSaved] = useState<Branding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [brandName, setBrandName] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [color, setColor] = useState("#5a4af0");
  const [logoUrl, setLogoUrl] = useState("");
  const [hidePoweredBy, setHidePoweredBy] = useState(false);
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [uploading, setUploading] = useState(false);

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const url = await uploadFile(file, "branding-logo");
      setLogoUrl(url);
      setNotice("Logo uploaded — remember to save.");
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not upload the logo.",
      );
    } finally {
      setUploading(false);
    }
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const b = await api.get<Branding>("/api/v1/partner/branding");
      setSaved(b);
      setBrandName(b.brandName ?? "");
      setCustomDomain(b.customDomain ?? "");
      setColor(b.brandColorHex);
      setLogoUrl(b.logoUrl ?? "");
      setHidePoweredBy(b.hidePoweredBy);
      setSenderName(b.senderName ?? "");
      setSenderEmail(b.senderEmail ?? "");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load branding.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const b = await api.put<Branding>("/api/v1/partner/branding", {
        brandName: brandName.trim() || null,
        customDomain: customDomain.trim() || null,
        brandColorHex: color,
        logoUrl: logoUrl.trim() || null,
        hidePoweredBy,
        senderName: senderName.trim() || null,
        senderEmail: senderEmail.trim() || null,
      });
      setSaved(b);
      setNotice("Branding saved.");
    } catch (e2) {
      setError(e2 instanceof ApiClientError ? e2.message : "Could not save branding.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyDomain() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const b = await api.post<Branding>("/api/v1/partner/branding/verify-domain", {});
      setSaved(b);
      setNotice("DNS verified. Your custom domain and branded sender are now eligible for use.");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "DNS could not be verified yet.");
    } finally {
      setBusy(false);
    }
  }

  const previewName = brandName.trim() || "Your brand";
  const previewDomain = customDomain.trim() || "app.youragency.com";

  return (
    <PartnerShell title="White-label">
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

      <div className="grid gap-3.5 lg:grid-cols-[340px_1fr] lg:items-start">
        {/* Settings */}
        <PtnCard>
          <span className="text-sm2 font-semibold text-ptn-ink">White-label settings</span>
          <form onSubmit={save} className="mt-4 flex flex-col gap-3.5">
            <label className="flex flex-col gap-1">
              <PtnLabel>Brand name</PtnLabel>
              <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="GrowLabs Local" className={inputCls} />
            </label>

            <label className="flex flex-col gap-1">
              <PtnLabel>Custom domain</PtnLabel>
              <input
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="app.youragency.com"
                className={`${inputCls} font-geist-mono text-xs2`}
              />
              {saved?.customDomain && (
                <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ptn-muted">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${saved.domainVerified ? "bg-ptn-accent" : "bg-[#f0b264]"}`}
                  />
                  {saved.domainVerified
                    ? "DNS verified"
                    : "Pending DNS verification"}
                </span>
              )}
              {saved?.customDomain && !saved.domainVerified && saved.domainVerificationToken && (
                <div className="mt-2 rounded-control border border-ptn-line bg-ptn-panel p-2.5 text-[11px] text-ptn-muted">
                  <div>Use either DNS record:</div>
                  <div className="mt-1 break-all font-geist-mono">CNAME {saved.customDomain} → {saved.cnameTarget}</div>
                  <div className="mt-1 break-all font-geist-mono">TXT _adgrowly.{saved.customDomain} → adgrowly-verification={saved.domainVerificationToken}</div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void verifyDomain()}
                    className="mt-2 rounded-control border border-ptn-accent px-2.5 py-1 text-[11px] font-semibold text-ptn-accent disabled:opacity-50"
                  >
                    {busy ? "Checking…" : "Verify DNS now"}
                  </button>
                </div>
              )}
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <PtnLabel>Email sender name</PtnLabel>
                <input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="GrowLabs" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <PtnLabel>Email sender</PtnLabel>
                <input type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="hello@youragency.com" className={inputCls} />
              </label>
            </div>
            <p className="-mt-2 text-[11px] text-ptn-subtle">
              Transactional email uses this identity only after the brand domain is verified; your SMTP relay must also authorize it.
            </p>

            <div className="flex flex-col gap-1.5">
              <PtnLabel>Brand colour</PtnLabel>
              <div className="flex items-center gap-2">
                {SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Use ${hex}`}
                    onClick={() => setColor(hex)}
                    className="h-[30px] w-[30px] rounded-full border-2"
                    style={{ background: hex, borderColor: color === hex ? "#edecf4" : "transparent" }}
                  />
                ))}
                <input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className={`${inputCls} w-24 font-geist-mono text-xs2`}
                />
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <PtnLabel>Logo</PtnLabel>
              <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" className={`${inputCls} font-geist-mono text-xs2`} />
              <div className="mt-1 flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-control border border-ptn-line bg-ptn-bg px-3 py-1.5 text-[11px] font-medium text-ptn-ink hover:border-ptn-accent">
                  {uploading ? "Uploading…" : "Upload image"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={onLogoFile}
                  />
                </label>
                <span className="text-[11px] text-ptn-subtle">or paste a hosted image URL above.</span>
              </div>
            </label>

            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={hidePoweredBy} onChange={(e) => setHidePoweredBy(e.target.checked)} />
              <span className="text-sm2 text-ptn-ink">Hide &ldquo;Powered by Adgrowly&rdquo;</span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="mt-1 rounded-control bg-ptn-accent px-4 py-2.5 text-sm2 font-semibold text-ptn-bg hover:bg-ptn-accent-hover disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save branding"}
            </button>
          </form>
        </PtnCard>

        {/* Live preview */}
        <PtnCard>
          <div className="flex items-center justify-between">
            <span className="text-sm2 font-semibold text-ptn-ink">Live preview — what your customers see</span>
            <span className="font-geist-mono text-micro text-ptn-subtle">{previewDomain}</span>
          </div>

          <div className="mt-3.5 overflow-hidden rounded-[14px] border border-ptn-line bg-gmb-canvas">
            {/* Fake browser chrome */}
            <div className="flex items-center gap-2 border-b border-[#dcdce6] bg-[#ebebf1] px-3.5 py-2">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-[9px] w-[9px] rounded-full bg-[#d3d3dd]" />
              ))}
              <span className="ml-2 flex-1 rounded-md bg-gmb-canvas px-2.5 py-0.5 font-geist-mono text-[10px] text-gmb-ink-subtle">
                {previewDomain}/dashboard
              </span>
            </div>
            {/* Mini branded dashboard */}
            <div className="flex h-[300px]">
              <div className="w-[150px] border-r border-gmb-line bg-gmb-surface p-3">
                <div className="mb-3 flex items-center gap-1.5">
                  {logoUrl.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="logo" className="h-[18px] w-[18px] rounded-md object-cover" />
                  ) : (
                    <span
                      className="flex h-[18px] w-[18px] items-center justify-center rounded-md text-[10px] font-bold text-white"
                      style={{ background: color }}
                    >
                      {previewName[0]?.toUpperCase() ?? "B"}
                    </span>
                  )}
                  <span className="text-[11px] font-semibold text-gmb-ink">{previewName}</span>
                </div>
                {["Dashboard", "Reviews", "Rank tracker", "Posts"].map((n, i) => (
                  <div
                    key={n}
                    className="mb-0.5 rounded-md px-2 py-1 text-[10px]"
                    style={i === 0 ? { background: `${color}1f`, color } : { color: "#56536a" }}
                  >
                    {n}
                  </div>
                ))}
              </div>
              <div className="flex-1 p-3.5">
                <div className="text-[13px] font-semibold text-gmb-ink">Dashboard</div>
                <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                  <div className="rounded-lg border border-gmb-line bg-gmb-surface px-2.5 py-2">
                    <div className="font-geist-mono text-[8px] text-gmb-ink-subtle">AVG RANK</div>
                    <div className="text-[14px] font-bold" style={{ color }}>
                      #4.2
                    </div>
                  </div>
                  <div className="rounded-lg border border-gmb-line bg-gmb-surface px-2.5 py-2">
                    <div className="font-geist-mono text-[8px] text-gmb-ink-subtle">RATING</div>
                    <div className="text-[14px] font-bold text-gmb-ink">4.8★</div>
                  </div>
                </div>
                <div
                  className="mt-1.5 rounded-lg border px-2.5 py-2 text-[10px]"
                  style={{ background: `${color}14`, borderColor: `${color}44`, color }}
                >
                  3 moves this week get you to #1
                </div>
                {!hidePoweredBy && (
                  <div className="mt-6 text-center font-geist-mono text-[8px] text-gmb-ink-subtle">
                    Powered by Adgrowly
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2 text-[11.5px] text-ptn-muted">
            <PtnPill tone="neutral">Note</PtnPill>
            <span>
              This preview shows how branding will apply to customer workspaces. Serving the app on
              your custom domain goes live once Adgrowly verifies your DNS.
            </span>
          </div>
        </PtnCard>
      </div>
    </PartnerShell>
  );
}
