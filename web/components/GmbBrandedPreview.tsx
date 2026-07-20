"use client";

// Live preview of a branded Google Business Profile post design: logo header +
// website, caption body, phone footer, and a CTA button — in the tenant's brand
// colors. This is the on-screen "wow"; a later slice rasterizes the same layout
// server-side and hosts it as the post image (GBP needs a hosted raster file).

export interface BrandKitLite {
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  primaryColor: string;
  secondaryColor: string;
}

const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: "Learn more",
  CALL: "Call now",
  ORDER: "Order",
  BOOK: "Book now",
  SIGN_UP: "Sign up",
  SHOP: "Shop now",
};

export function GmbBrandedPreview({
  kit,
  businessName,
  caption,
  ctaType,
}: {
  kit: BrandKitLite;
  businessName: string;
  caption: string;
  ctaType?: string | null;
}) {
  const name = businessName.trim() || "Your business";
  const ctaLabel = ctaType ? CTA_LABELS[ctaType] ?? null : null;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 shadow-sm">
      {/* Header: logo + business name (left), website (right) */}
      <div className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: kit.primaryColor }}>
        <div className="flex items-center gap-2 min-w-0">
          {kit.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={kit.logoUrl} alt="logo" className="h-8 w-8 rounded bg-white/90 object-contain p-0.5" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded bg-white/20 text-sm font-bold text-white">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="truncate text-sm font-semibold text-white">{name}</span>
        </div>
        {kit.website && (
          <span className="truncate pl-2 text-xs text-white/85">{kit.website.replace(/^https?:\/\//, "")}</span>
        )}
      </div>

      {/* Body: the caption */}
      <div className="bg-white px-4 py-5">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
          {caption || "Your post caption will appear here — generate a draft to preview it in your brand style."}
        </p>
        {ctaLabel && (
          <button
            type="button"
            className="mt-4 rounded-md px-4 py-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: kit.secondaryColor }}
          >
            {ctaLabel}
          </button>
        )}
      </div>

      {/* Footer: phone */}
      <div className="flex items-center justify-center px-4 py-2 text-xs font-medium text-white" style={{ backgroundColor: kit.secondaryColor }}>
        {kit.phone ? `📞 ${kit.phone}` : "Add a phone number in your brand kit"}
      </div>
    </div>
  );
}
