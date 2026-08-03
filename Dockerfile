FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/dist/standalone ./
COPY --from=build --chown=node:node /app/scripts/model-market ./scripts/model-market
COPY --from=build --chown=node:node /app/data/model-market-registry.mjs ./data/model-market-registry.mjs
COPY --from=build --chown=node:node /app/data/model-market-registry.mjs ./market-registry/model-market-registry.mjs
COPY --from=build --chown=node:node /app/data/model-market.snapshot.json ./data/model-market.snapshot.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
