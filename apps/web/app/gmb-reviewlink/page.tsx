"use client";

// Review link & QR — the tools that actually generate review volume: a
// shareable Google "leave a review" URL for the active location, a downloadable
// QR code for print/table tents, and a ready-to-send request message.
//
// The URL only exists once the profile has a Google placeId, so a location that
// isn't connected shows a connect prompt rather than a broken QR.

import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { GmbShell, useActiveLocationId } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel, Button, EmptyState, ErrorNote, Skeleton } from "../../src/components/gmb/ui";
import { api, ApiClientError } from "../../src/lib/api";

interface ReviewLink {
  placeId: string | null;
  url: string | null;
  requestText: string;
}

export default function GmbReviewLinkPage() {
  const locationId = useActiveLocationId();
  const [data, setData] = useState<ReviewLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "text" | null>(null);

  const load = useCallback(async () => {
    if (!locationId) {
      setData(null);
      return;
    }
    setError(null);
    setData(null);
    setQr(null);
    try {
      setData(await api.get<ReviewLink>(`/api/v1/gmb/locations/${locationId}/review-link`));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load the review link.");
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Render the QR to a PNG data URL client-side (no network) whenever the URL
  // changes; the same data URL backs both the preview and the download.
  useEffect(() => {
    if (!data?.url) {
      setQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(data.url, { width: 512, margin: 2 })
      .then((u) => {
        if (!cancelled) setQr(u);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [data?.url]);

  async function copy(kind: "url" | "text", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    } catch {
      setError("Couldn't copy to the clipboard — select and copy manually.");
    }
  }

  return (
    <GmbShell title="Review link & QR">
      {error && <ErrorNote>{error}</ErrorNote>}

      {!locationId ? (
        <EmptyState
          title="No location selected"
          body="Add a location to generate its review link and QR code."
          action={
            <Link href="/gmb-locations" className="no-underline hover:no-underline">
              <Button>Go to locations</Button>
            </Link>
          }
        />
      ) : data === null ? (
        <div className="grid gap-3.5 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : data.url === null ? (
        <EmptyState
          title="Connect this location to Google first"
          body="A review link points to your Google Business Profile, so it needs a Google place ID. Connect the location, then this page generates the link and QR automatically."
          action={
            <Link href="/gmb-connect" className="no-underline hover:no-underline">
              <Button>Connect Google</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-[1fr_320px] lg:items-start">
          {/* Link + request text */}
          <div className="flex flex-col gap-3.5">
            <Card>
              <SectionLabel>Your Google review link</SectionLabel>
              <p className="mt-1 text-xs2 text-gmb-ink-muted">
                Share this anywhere — it opens the Google review form for your profile.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  readOnly
                  value={data.url}
                  className="flex-1 rounded-control border border-gmb-line bg-gmb-canvas px-3 py-2 font-geist-mono text-xs2 text-gmb-ink outline-none"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button onClick={() => void copy("url", data.url!)}>
                  {copied === "url" ? "Copied" : "Copy"}
                </Button>
                <a href={data.url} target="_blank" rel="noopener noreferrer" className="no-underline hover:no-underline">
                  <Button variant="ghost">Open</Button>
                </a>
              </div>
            </Card>

            <Card>
              <SectionLabel>Ready-to-send request</SectionLabel>
              <p className="mt-1 text-xs2 text-gmb-ink-muted">
                Paste into SMS or email after a visit.
              </p>
              <textarea
                readOnly
                value={data.requestText}
                rows={6}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-3 w-full resize-y rounded-control border border-gmb-line bg-gmb-canvas p-3 text-sm2 text-gmb-ink outline-none"
              />
              <div className="mt-2">
                <Button onClick={() => void copy("text", data.requestText)}>
                  {copied === "text" ? "Copied" : "Copy message"}
                </Button>
              </div>
            </Card>
          </div>

          {/* QR */}
          <Card className="flex flex-col items-center text-center">
            <SectionLabel>QR code</SectionLabel>
            <p className="mt-1 text-xs2 text-gmb-ink-muted">
              Print on receipts, table tents or flyers.
            </p>
            {qr ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={qr}
                alt="Review QR code"
                className="mt-3 h-52 w-52 rounded-control border border-gmb-line bg-white p-2"
              />
            ) : (
              <Skeleton className="mt-3 h-52 w-52" />
            )}
            <div className="mt-3">
              <a
                href={qr ?? "#"}
                download="review-qr.png"
                className={`no-underline hover:no-underline ${qr ? "" : "pointer-events-none opacity-50"}`}
              >
                <Button>Download PNG</Button>
              </a>
            </div>
          </Card>
        </div>
      )}
    </GmbShell>
  );
}
