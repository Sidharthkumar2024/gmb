const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Lint runs in a separate `npm run lint` step (turbo's lint task). The
  // production build shouldn't gate on it — externally-edited pages have
  // been failing the build for missing-rule-definition errors unrelated
  // to whatever's actually changing. Keep `next lint` available; just
  // don't block builds with it.
  eslint: { ignoreDuringBuilds: true },
  // Emit a self-contained runtime bundle under .next/standalone for the
  // production Docker image. Slashes the runtime layer from ~500MB to ~150MB
  // by skipping node_modules and dev deps.
  output: "standalone",
  // The Dockerfile copies the build context relative to the monorepo root;
  // tell Next where the workspace root lives so it traces correctly.
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../../"),
  },
  transpilePackages: ["@nexaflow/shared", "@nexaflow/ui"],
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.modules = [
      path.resolve(__dirname, "node_modules"),
      ...(config.resolve.modules || []),
    ];
    return config;
  },
  // CDN cache headers (T-113). Hashed build assets are immutable; the
  // marketing root is stable enough to edge-cache with revalidation;
  // public image/text files cache for an hour. Auth-gated dashboard
  // pages intentionally stay uncached (no header → Next default).
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/_next/image/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
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
