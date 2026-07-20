import { readBillingIntentFromSearchParams } from "../../../src/lib/billingIntent";
import { LoginForm } from "./LoginForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return (
    <LoginForm
      billingIntent={readBillingIntentFromSearchParams(searchParams)}
    />
  );
}
