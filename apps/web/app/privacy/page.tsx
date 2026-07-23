import Link from "next/link";
import { LegalPage } from "../../src/components/gmb/LegalPage";

// Placeholder Privacy page. Linked from signup, so it must exist and be honest:
// it states that the final policy is in preparation rather than inventing one.
// Replace the body with the reviewed Privacy Policy before launch.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Our full Privacy Policy is being finalised ahead of general availability. It will describe
        exactly what data Adgrowly GMB Suite collects, how it is used to manage your Google Business
        Profile, and the controls you have over it.
      </p>
      <p>
        Adgrowly connects to Google Business Profile only with access you grant, and that access can
        be revoked at any time from your Google account. For any question about your data before the
        policy is published, contact us at{" "}
        <a href="mailto:hello@adgrowly.ca" className="font-semibold text-gmb-brand">
          hello@adgrowly.ca
        </a>
        .
      </p>
      <p className="text-sm2 text-gmb-ink-subtle">
        This is a placeholder and does not constitute the final Privacy Policy.
      </p>
      <p>
        <Link href="/signup" className="font-semibold text-gmb-brand">
          ← Back to sign up
        </Link>
      </p>
    </LegalPage>
  );
}
