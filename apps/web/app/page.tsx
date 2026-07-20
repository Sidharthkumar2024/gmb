import { redirect } from "next/navigation";

// This app has a single workspace, so the root sends straight to it. The
// dashboard itself redirects to /login when there is no session.
export default function RootPage() {
  redirect("/gmb-dashboard");
}
