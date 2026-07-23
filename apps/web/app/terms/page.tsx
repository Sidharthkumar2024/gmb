import Link from "next/link";
import { LegalPage } from "../../src/components/gmb/LegalPage";

// Placeholder Terms page. The signup flow links here, so it must exist and be
// honest: rather than fabricate binding legal text, it states plainly that the
// final terms are being prepared and points to a contact. Replace the body with
// the reviewed Terms of Service before launch.
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These Terms of Service are being finalised ahead of general availability. The full,
        reviewed terms will be published here before Adgrowly GMB Suite opens to the public.
      </p>
      <p>
        In the meantime, your use of the product during early access is governed by the agreement
        provided to you directly. If you have questions about the terms that apply to your account,
        contact us at{" "}
        <a href="mailto:hello@adgrowly.ca" className="font-semibold text-gmb-brand">
          hello@adgrowly.ca
        </a>
        .
      </p>
      <p className="text-sm2 text-gmb-ink-subtle">
        This is a placeholder and does not constitute the final Terms of Service.
      </p>
      <p>
        <Link href="/signup" className="font-semibold text-gmb-brand">
          ← Back to sign up
        </Link>
      </p>
    </LegalPage>
  );
}
