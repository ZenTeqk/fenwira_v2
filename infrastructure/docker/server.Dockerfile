# syntax=docker/dockerfile:1.7
# api, worker and migrate images from one pruned, cached build (docs/DEPLOYMENT.md).
# Targets: api | worker | migrate | meta-mock | dev (full workspace + dev deps; dev compose and test runner).

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PNPM_VERSION=10.34.5
ARG TURBO_VERSION=2.11.3

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true PRISMA_HIDE_UPDATE_MESSAGE=1 NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@${PNPM_VERSION} \
 && pnpm config set store-dir /pnpm/store
WORKDIR /repo

# Keep only what api + worker (and their workspace deps) need.
FROM base AS pruned
ARG TURBO_VERSION
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @fenwira/api @fenwira/worker --docker

FROM base AS deps
COPY --from=pruned /repo/out/json/ ./
COPY --from=pruned /repo/.npmrc ./.npmrc
RUN --mount=type=cache,id=fenwira-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY --from=pruned /repo/out/full/ ./
RUN pnpm turbo run build --filter=@fenwira/worker... --filter=@fenwira/api...

# Development / test runner: everything built, dev dependencies present.
FROM build AS dev
CMD ["pnpm", "turbo", "run", "dev", "--filter=@fenwira/api..."]

FROM base AS prod-deps
COPY --from=pruned /repo/out/json/ ./
COPY --from=pruned /repo/.npmrc ./.npmrc
RUN --mount=type=cache,id=fenwira-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --from=pruned /repo/out/full/packages/database/prisma ./packages/database/prisma
RUN pnpm --filter @fenwira/database exec prisma generate

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PRISMA_HIDE_UPDATE_MESSAGE=1
# Patch the base image's PCRE library; runtime entrypoints use Node directly, not npm.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates libpcre2-8-0 \
 && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /repo
COPY --from=prod-deps --chown=node:node /repo ./
COPY --from=build --chown=node:node /repo/packages/config/dist ./packages/config/dist
COPY --from=build --chown=node:node /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /repo/packages/queue/dist ./packages/queue/dist
COPY --from=build --chown=node:node /repo/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /repo/packages/database/sql ./packages/database/sql
COPY --from=build --chown=node:node /repo/packages/whatsapp/dist ./packages/whatsapp/dist
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
USER node

FROM runtime AS api
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /repo/apps/worker/dist ./apps/worker/dist
EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4100/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/worker/dist/main.js"]

FROM runtime AS migrate
CMD ["node", "packages/database/dist/cli/migrate.js"]

# Simulated Meta Graph API (local dev connect and demos; never points at real Meta data).
FROM runtime AS meta-mock
ENV PORT=4200
EXPOSE 4200
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:4200/__mock/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/whatsapp/dist/testing/server.js"]
