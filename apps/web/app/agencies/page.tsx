import type { Metadata } from "next";
import { MarketingAgencies } from "../../src/components/gmb/MarketingAgencies";
import { MarketingShell } from "../../src/components/gmb/MarketingShell";

export const metadata: Metadata = {
  title: "For agencies — GMB Suite by Adgrowly",
  description: "White-label GMB Suite partner portal, resale plans and customer billing.",
};

export default function AgenciesPage() {
  return <MarketingShell active="agencies"><MarketingAgencies /></MarketingShell>;
}
