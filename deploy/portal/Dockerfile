# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build

WORKDIR /source
RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.15.1 --activate
RUN mkdir -p apps/portal packages/identity packages/portal-protocol
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/portal/package.json apps/portal/package.json
COPY packages/identity/package.json packages/identity/package.json
COPY packages/portal-protocol/package.json packages/portal-protocol/package.json
RUN pnpm install --frozen-lockfile --filter @takeboard/portal...
COPY tsconfig.base.json ./
COPY apps/portal apps/portal
COPY packages/identity packages/identity
COPY packages/portal-protocol packages/portal-protocol
RUN pnpm portal:build \
  && pnpm --filter @takeboard/portal deploy --prod /opt/takeboard-portal

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    TAKEBOARD_PORTAL_BIND_HOST=0.0.0.0 \
    TAKEBOARD_PORTAL_PORT=49200 \
    TAKEBOARD_PORTAL_DATABASE=/var/lib/takeboard-portal/portal.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 takeboard-portal \
  && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin takeboard-portal \
  && mkdir -p /var/lib/takeboard-portal \
  && chown takeboard-portal:takeboard-portal /var/lib/takeboard-portal

WORKDIR /opt/takeboard-portal
COPY --from=build --chown=takeboard-portal:takeboard-portal /opt/takeboard-portal/ ./
COPY --chown=takeboard-portal:takeboard-portal deploy/portal/container-healthcheck.mjs ./container-healthcheck.mjs

USER takeboard-portal
EXPOSE 49200
VOLUME ["/var/lib/takeboard-portal"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "container-healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
