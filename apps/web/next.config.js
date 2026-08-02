const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 no longer runs lint during `next build`; CI owns the explicit
  // `npm run lint` quality gate.
  // Emit a self-contained runtime bundle under .next/standalone for the
  // production Docker image. Slashes the runtime layer from ~500MB to ~150MB
  // by skipping node_modules and dev deps.
  output: "standalone",
  // The Dockerfile copies the build context relative to the monorepo root;
  // tell Next where the workspace root lives so it traces correctly.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@nexaflow/shared"],
  // CDN cache headers (T-113). Next owns caching for its static assets and
  // image optimizer; the marketing root and public files keep explicit edge
  // policies. Auth-gated dashboard pages intentionally stay uncached.
  async headers() {
    return [
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/:path*.{png,jpg,jpeg,gif,webp,svg,ico,txt}",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
