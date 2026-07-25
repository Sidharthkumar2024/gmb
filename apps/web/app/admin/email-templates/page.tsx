"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdmCard, AdmLabel, AdmPill } from "../../../src/components/gmb/AdminShell";
import { api, ApiClientError } from "../../../src/lib/api";

// Email templates — customise the transactional emails the platform sends.
// Overriding is opt-in per template: with "Use custom" off, the tested built-in
// default is sent, so a bad edit can never silently break an auth email.

interface Template {
  key: string;
  name: string;
  description: string;
  placeholders: string[];
  subject: string; // effective (custom or default)
  body: string;
  useCustom: boolean;
  updatedAt: string | null;
  defaultSubject: string;
  defaultBody: string;
}

const inputCls =
  "w-full rounded-control border border-adm-line bg-adm-bg px-3 py-2 text-sm2 text-adm-ink outline-none placeholder:text-adm-subtle focus:border-gmb-brand";

export default function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTemplates((await api.get<Template[]>("/api/v1/admin/email-templates")) ?? []);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load templates.");
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function edit(t: Template) {
    setOpenKey(t.key);
    setSubject(t.subject);
    setBody(t.body);
    setUseCustom(t.useCustom);
    setNotice(null);
  }

  async function save(key: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/api/v1/admin/email-templates/${key}`, {
        subject: subject.trim(),
        body: body.trim(),
        useCustom,
      });
      setNotice(useCustom ? "Saved — this email now sends your custom version." : "Saved — this email sends the built-in default.");
      setOpenKey(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the template.");
    } finally {
      setBusy(false);
    }
  }

  const open = templates?.find((t) => t.key === openKey) ?? null;

  return (
    <AdminShell title="Email templates">
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
        <AdmLabel>Scope</AdmLabel>
        <span className="text-xs2 text-adm-muted">
          The transactional emails this platform sends. Editing is opt-in per template — the tested
          default sends until you turn on the custom version.
        </span>
      </div>

      {templates === null ? (
        <AdmCard>
          <div className="py-8 text-center font-geist-mono text-xs text-adm-subtle">loading…</div>
        </AdmCard>
      ) : (
        <div className="flex flex-col gap-2.5">
          {templates.map((t) => (
            <AdmCard key={t.key}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-adm-ink">{t.name}</span>
                    <AdmPill tone={t.useCustom ? "brand" : "neutral"}>
                      {t.useCustom ? "Custom" : "Default"}
                    </AdmPill>
                  </div>
                  <div className="mt-0.5 text-xs2 text-adm-muted">{t.description}</div>
                  <div className="mt-1.5 font-geist-mono text-micro text-adm-subtle">
                    Subject: {t.subject}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => edit(t)}
                  className="flex-shrink-0 rounded-control border border-adm-line px-3 py-1.5 text-xs2 font-medium text-adm-ink hover:bg-adm-panel-hover"
                >
                  Edit
                </button>
              </div>

              {openKey === t.key && open && (
                <div className="mt-3 border-t border-adm-line pt-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-micro uppercase tracking-wide text-adm-subtle">Subject</span>
                    <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} />
                  </label>
                  <label className="mt-3 flex flex-col gap-1">
                    <span className="text-micro uppercase tracking-wide text-adm-subtle">
                      Body — placeholders: {open.placeholders.map((p) => `{{${p}}}`).join(", ")}
                    </span>
                    <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className={inputCls} />
                  </label>
                  <label className="mt-3 flex items-center gap-2.5">
                    <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
                    <span className="text-sm2 text-adm-ink">Use this custom version (off = send the built-in default)</span>
                  </label>
                  <div className="mt-3 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setSubject(open.defaultSubject);
                        setBody(open.defaultBody);
                      }}
                      className="text-xs2 text-adm-subtle hover:text-adm-ink"
                    >
                      Reset to default text
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenKey(null)}
                        className="rounded-control border border-adm-line px-4 py-2 text-sm2 font-medium text-adm-muted hover:bg-adm-panel-hover"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void save(t.key)}
                        className="rounded-control bg-gmb-brand px-4 py-2 text-sm2 font-semibold text-white hover:bg-gmb-brand-hover disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </AdmCard>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
