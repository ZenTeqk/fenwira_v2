# syntax=docker/dockerfile:1.7
# Next.js standalone image for apps/web (docs/DEPLOYMENT.md).

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PNPM_VERSION=10.34.5
ARG TURBO_VERSION=2.11.3

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@${PNPM_VERSION} && pnpm config set store-dir /pnpm/store
WORKDIR /repo

FROM base AS pruned
ARG TURBO_VERSION
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @fenwira/web --docker

FROM base AS deps
COPY --from=pruned /repo/out/json/ ./
COPY --from=pruned /repo/.npmrc ./.npmrc
RUN --mount=type=cache,id=fenwira-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
# NEXT_PUBLIC_* values are inlined at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_NAV_PREVIEW=false
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_PUBLIC_NAV_PREVIEW=${NEXT_PUBLIC_NAV_PREVIEW}
COPY --from=pruned /repo/out/full/ ./
RUN pnpm turbo run build --filter=@fenwira/web...

FROM build AS dev
CMD ["pnpm", "--filter", "@fenwira/web", "dev"]

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
# Patch the base image's PCRE library and omit unused npm from the standalone runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpcre2-8-0 \
 && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
