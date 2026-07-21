import { prisma } from "@nexaflow/db";
import {
  saveGoogleOAuthConfig,
  getSafeGoogleOAuthConfig,
} from "../../../apps/api/src/services/googleOAuthConfig.service";

// One-shot setup: move the Google OAuth client from environment variables into
// the encrypted GoogleOAuthConfig row.
//
// Why bother when the code already falls back to env? Because the DB row is
// the path the admin UI reads and writes, it is envelope-encrypted at rest,
// and it survives a deploy that forgets an env var. The env vars stay as the
// bootstrap source so a fresh machine needs no manual step.
//
//   npm run db:setup-google
//
// This delegates to saveGoogleOAuthConfig rather than writing the row itself.
// The first version duplicated that upsert and invented its own primary key,
// so the row was written where nothing read it — the service keys on
// CONFIG_ID = "default". Calling the service keeps the id, the encryption and
// the cache-priming in exactly one place.
//
// The secret is never printed — only its last 4 characters, which is what the
// admin UI shows too.

async function main() {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const redirectUri = (process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "").trim();

  if (!clientId || !clientSecret) {
    console.error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env before running this.",
    );
    process.exit(1);
  }
  if (!process.env.TENANT_TOKEN_ENCRYPTION_KEY) {
    console.error(
      "TENANT_TOKEN_ENCRYPTION_KEY must be set — the client secret is encrypted at rest and cannot be stored without it.",
    );
    process.exit(1);
  }

  await saveGoogleOAuthConfig({
    clientId,
    clientSecret,
    redirectUri,
    enabled: true,
  });

  // Read back through the same accessor the app uses, so this reports what the
  // application will actually see rather than what we just wrote.
  const saved = await getSafeGoogleOAuthConfig();

  console.log("✓ Google OAuth client stored (encrypted at rest)");
  console.log(`  client id     ${saved.clientId}`);
  console.log(`  client secret ${saved.hasSecret ? `••••${saved.secretLast4}` : "MISSING"}`);
  console.log(`  redirect uri  ${saved.redirectUri || "(not set)"}`);
  console.log(`  enabled       ${saved.enabled}`);
  console.log("");
  console.log(
    "Reminder: this exact redirect URI must be listed under Authorized redirect URIs",
  );
  console.log("on the OAuth client in Google Cloud Console, or Google returns");
  console.log("redirect_uri_mismatch.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
