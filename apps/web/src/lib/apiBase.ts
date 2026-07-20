// Single source of truth for the API base URL the browser calls.
//
// Priority:
//   1. NEXT_PUBLIC_API_URL if set at build time (explicit override).
//   2. Same-origin in the browser when served from a real host — the reverse
//      proxy (nginx/Caddy) forwards /api and /webhooks to the API, so the
//      frontend just calls its own origin. This makes IP/domain deploys work
//      WITHOUT rebuilding with a baked URL.
//   3. http://localhost:3001 for local dev (web :3000, api :3001).
export function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (hostname !== "localhost" && hostname !== "127.0.0.1") return origin;
  }
  return "http://localhost:3001";
}
