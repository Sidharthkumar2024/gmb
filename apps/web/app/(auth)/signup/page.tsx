import { readBillingIntentFromSearchParams } from "../../../src/lib/billingIntent";
import { SignupForm } from "./SignupForm";

export default function SignupPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return (
    <SignupForm
      billingIntent={readBillingIntentFromSearchParams(searchParams)}
    />
  );
}
