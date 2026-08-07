FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3 AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

ARG KAI_RELEASE_SHA
RUN printf '%s\n' "$KAI_RELEASE_SHA" | grep -Eq '^([0-9a-f]{40}|[0-9a-f]{64})$' \
    && ! printf '%s\n' "$KAI_RELEASE_SHA" | grep -Eq '^0+$'

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3 AS runtime

WORKDIR /app
ARG KAI_RELEASE_SHA
LABEL org.opencontainers.image.title="KAI Cloud Market" \
      org.opencontainers.image.revision="${KAI_RELEASE_SHA}"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    KAI_BUILD_REVISION="${KAI_RELEASE_SHA}" \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/dist/standalone ./
COPY --from=build --chown=node:node /app/scripts/model-market ./scripts/model-market
COPY --from=build --chown=node:node /app/scripts/ops ./scripts/ops
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/data/model-market-registry.mjs ./data/model-market-registry.mjs
COPY --from=build --chown=node:node /app/data/model-market-registry.mjs ./market-registry/model-market-registry.mjs
COPY --from=build --chown=node:node /app/data/model-market.snapshot.json ./data/model-market.snapshot.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/live" || exit 1

ENTRYPOINT ["/bin/sh", "/app/scripts/ops/production-entrypoint.sh"]
CMD ["node", "server.js"]
