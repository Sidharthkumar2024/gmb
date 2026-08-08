import Link from "next/link";
import { GmbShell } from "../../src/components/gmb/GmbShell";
import { Card, SectionLabel } from "../../src/components/gmb/ui";

const BENEFITS = [
  ["Your brand", "Use your logo, brand colour, verified domain and sender identity."],
  ["Your customers", "Create and manage separate GMB workspaces from one partner portal."],
  ["Your pricing", "Set resale plans while wholesale cost and margin stay visible per currency."],
  ["Your operations", "Manage Google connections, reports, billing, support and team access."],
];

export default function GmbWhiteLabelPage() {
  return (
    <GmbShell title="Go white-label">
      <div className="grid grid-cols-[1.35fr_1fr] gap-3.5">
        <Card className="p-7">
          <SectionLabel>For agencies & consultants</SectionLabel>
          <h2 className="mt-3 max-w-[620px] text-[30px] font-bold leading-[1.15] tracking-[-0.025em] text-gmb-ink">
            Offer the complete GMB Suite under your own brand.
          </h2>
          <p className="mt-3 max-w-[650px] text-sm2 leading-relaxed text-gmb-ink-muted">
            Run customer workspaces, plans, payments and Google Business Profile operations from a dedicated partner portal without changing the customer-facing workflow.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {BENEFITS.map(([title, body]) => (
              <div key={title} className="rounded-[14px] border border-gmb-line bg-gmb-canvas p-4">
                <div className="text-sm2 font-semibold text-gmb-ink">{title}</div>
                <div className="mt-1 text-xs2 leading-relaxed text-gmb-ink-muted">{body}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col justify-between bg-[#1a1726] p-7 text-white">
          <div>
            <div className="font-geist-mono text-micro uppercase tracking-[0.1em] text-white/50">
              Agency programme
            </div>
            <div className="mt-3 text-[24px] font-bold leading-tight tracking-[-0.02em]">
              Ready to manage multiple GMB customers?
            </div>
            <p className="mt-3 text-sm2 leading-relaxed text-white/65">
              Review the agency workflow, white-label controls and current plans before requesting partner access.
            </p>
          </div>
          <Link
            href="/agencies"
            className="mt-8 block rounded-[9px] bg-white px-4 py-2.5 text-center text-sm2 font-semibold text-[#1a1726] no-underline hover:bg-white/90 hover:no-underline"
          >
            Explore agency plans
          </Link>
        </Card>
      </div>
    </GmbShell>
  );
}
