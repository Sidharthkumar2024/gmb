"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Email (SMTP) — platform outbound-mail settings.
//
// The password is stored encrypted in the Secret Vault and never comes back
// to the browser (last-4 mask only). Saved settings win over the env SMTP_*
// fallback for every email the platform sends: verification, password reset,
// rank alerts. The test button sends a REAL email and reports the relay's
// actual response — it never fakes success.

interface SmtpView {
  admin: {
    host: string | null;
    port: number;
    secure: boolean;
    user: string | null;
    fromEmail: string | null;
    fromName: string | null;
    passwordLast4: string | null;
  } | null;
  env: { configured: boolean; host: string | null };
}

const inputCls =
  "rounded-control border border-adm-line bg-adm-bg px-3 py-2 text-sm2 text-adm-ink outline-none placeholder:text-adm-subtle focus:border-gmb-brand";

export default function AdminEmailPage() {
  const [data, setData] = useState<SmtpView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form state
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [saving, setSaving] = useState(false);

  // Test state
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.get<SmtpView>("/api/v1/admin/smtp");
      setData(d);
      if (d.admin) {
        setHost(d.admin.host ?? "");
        setPort(String(d.admin.port));
        setUser(d.admin.user ?? "");
        setFromEmail(d.admin.fromEmail ?? "");
        setFromName(d.admin.fromName ?? "");
      }
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load SMTP settings.");
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
      await api.put("/api/v1/admin/smtp", {
        host: host.trim(),
        port: Number(port) || 587,
        ...(user.trim() ? { user: user.trim() } : {}),
        ...(password ? { password } : {}),
        fromEmail: fromEmail.trim(),
        ...(fromName.trim() ? { fromName: fromName.trim() } : {}),
      });
      setPassword("");
      setNotice("Settings saved. They apply to the next email sent.");
      await load();
    } catch (e2) {
      setError(e2 instanceof ApiClientError ? e2.message : "Could not save SMTP settings.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete the saved SMTP settings? Email falls back to env SMTP_* or turns off."))
      return;
    setError(null);
    setNotice(null);
    try {
      await api.delete("/api/v1/admin/smtp");
      setHost("");
      setPort("587");
      setUser("");
      setPassword("");
      setFromEmail("");
      setFromName("");
      setNotice("Saved settings deleted.");
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not delete the settings.");
    }
  }

  async function runTest(e: React.FormEvent) {
    e.preventDefault();
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(
        await api.post<{ ok: boolean; message: string }>("/api/v1/admin/smtp/test", {
          to: testTo.trim(),
        }),
      );
    } catch (e2) {
      setTestResult({
        ok: false,
        message: e2 instanceof ApiClientError ? e2.message : "Test request failed.",
      });
    } finally {
      setTesting(false);
    }
  }

  const active = data?.admin ? "admin" : data?.env.configured ? "env" : "off";

  return (
    <AdminShell title="Email">
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

      <div className="grid grid-cols-2 gap-3.5">
        <AdmCard>
          <div className="flex items-center justify-between">
            <AdmLabel>Delivery status</AdmLabel>
            <AdmPill tone={active === "off" ? "warn" : "ok"}>
              {active === "admin"
                ? "Using saved settings"
                : active === "env"
                  ? "Using env fallback"
                  : "Email off"}
            </AdmPill>
          </div>
          <div className="mt-2 text-xs2 leading-relaxed text-adm-muted">
            {active === "admin" && data?.admin
              ? `${data.admin.host}:${data.admin.port} · from ${data.admin.fromEmail}${data.admin.user ? ` · auth as ${data.admin.user}` : " · no auth"}${data.admin.passwordLast4 ? ` · password ••••${data.admin.passwordLast4}` : ""}`
              : active === "env"
                ? `Env SMTP_HOST (${data?.env.host}) serves all email until settings are saved here.`
                : "Verification, password-reset and alert emails are skipped (logged server-side) until SMTP is configured."}
          </div>
        </AdmCard>

        <AdmCard>
          <AdmLabel>What uses this</AdmLabel>
          <div className="mt-2 text-xs2 leading-relaxed text-adm-muted">
            Email verification, password resets and rank alerts. Saved settings win over env; a
            send failure never blocks the signup or reset flow — those requests still succeed and
            the failure is logged.
          </div>
        </AdmCard>
      </div>

      <div className="mt-3.5">
        <div className="mb-2 flex items-center gap-2">
          <AdmLabel>SMTP server</AdmLabel>
        </div>
        <AdmCard>
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">Host</span>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.resend.com" required className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">Port</span>
              <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" inputMode="numeric" required className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">User (optional)</span>
              <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="leave empty for no auth" autoComplete="off" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">
                Password {data?.admin?.passwordLast4 ? `(saved ••••${data.admin.passwordLast4} — leave empty to keep)` : "(required with a user)"}
              </span>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="••••••••" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">From email</span>
              <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} type="email" placeholder="no-reply@adgrowly.ca" required className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-adm-subtle">From name (optional)</span>
              <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Adgrowly" className={inputCls} />
            </label>
            <div className="col-span-2 flex items-center justify-between">
              <span className="text-xs2 text-adm-muted">
                Port 465 uses implicit TLS; 587 upgrades via STARTTLS.
              </span>
              <div className="flex gap-2">
                {data?.admin && (
                  <button
                    type="button"
                    onClick={() => void remove()}
                    className="rounded-control border border-adm-line px-4 py-2 text-sm2 font-medium text-[#ff8f85] hover:bg-gmb-danger/10"
                  >
                    Delete saved settings
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving || !host.trim() || !fromEmail.trim()}
                  className="rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white hover:bg-gmb-brand-hover disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
              </div>
            </div>
          </form>
        </AdmCard>
      </div>

      <div className="mt-3.5">
        <div className="mb-2 flex items-center gap-2">
          <AdmLabel>Send a test email</AdmLabel>
          <span className="text-xs2 text-adm-muted">sends a real message through the active settings</span>
        </div>
        <AdmCard>
          <form onSubmit={runTest} className="flex gap-2">
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              type="email"
              required
              placeholder="you@example.com"
              className={`flex-1 ${inputCls}`}
            />
            <button
              type="submit"
              disabled={testing || !testTo.trim()}
              className="rounded-control border border-adm-line bg-adm-panel px-4 py-2 text-sm2 font-semibold text-adm-ink hover:bg-adm-panel-hover disabled:opacity-50"
            >
              {testing ? "Sending…" : "Send test"}
            </button>
          </form>
          {testResult && (
            <div
              className={`mt-3 rounded-control border px-3 py-2 text-sm2 ${
                testResult.ok
                  ? "border-adm-ok/30 bg-adm-ok/10 text-adm-ok"
                  : "border-gmb-danger/30 bg-gmb-danger/10 text-[#ff8f85]"
              }`}
            >
              {testResult.ok ? "Delivered: " : "Failed: "}
              {testResult.message}
            </div>
          )}
        </AdmCard>
      </div>
    </AdminShell>
  );
}
