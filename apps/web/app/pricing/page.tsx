import type { Metadata } from "next";
import { MarketingPricing } from "../../src/components/gmb/MarketingPricing";
import { MarketingShell } from "../../src/components/gmb/MarketingShell";

export const metadata: Metadata = {
  title: "Pricing — GMB Suite by Adgrowly",
  description: "Live GMB Suite plan pricing and entitlements.",
};

export default function PricingPage() {
  return <MarketingShell active="pricing"><MarketingPricing /></MarketingShell>;
}
