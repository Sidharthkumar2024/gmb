# Multi-stage build for the GMB API.
#
# The Prisma schema is copied BEFORE `npm ci`, because packages/db's postinstall
# runs `prisma generate` and fails without it. This exact ordering bug broke CI
# in the parent monorepo, so it is preserved deliberately here.

FROM node:20-alpine AS deps
WORKDIR /app

# Manifests first so this layer caches until dependencies actually change.
COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
# Needed by packages/db's postinstall (prisma generate).
COPY packages/db/prisma ./packages/db/prisma

RUN npm ci --omit=dev --ignore-scripts \
    && npm install --no-save prisma@^5.1.0 \
    && npx prisma generate --schema packages/db/prisma/schema.prisma

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm ci --ignore-scripts \
    && npx prisma generate --schema packages/db/prisma/schema.prisma \
    && npx tsc -p apps/api/tsconfig.json

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run unprivileged: a container escape should not land as root.
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages ./packages
COPY package.json ./

USER app
EXPOSE 3001

# Report unhealthy when Postgres is unreachable, not merely when the process is
# alive — /health checks the database (see apps/api/src/index.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/apps/api/src/index.js"]
