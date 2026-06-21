# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS producer_api_deps
WORKDIR /app/producer_api
COPY producer_api/package.json ./
RUN npm install --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM node:${NODE_VERSION} AS producer_api
ENV NODE_ENV=production
WORKDIR /app/producer_api
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=producer_api_deps /app/producer_api/node_modules ./node_modules
COPY producer_api/package.json ./
COPY producer_api/server.mjs ./
COPY producer_api/lib ./lib
COPY producer_api/migrations ./migrations
COPY producer_api/scripts ./scripts
EXPOSE 8787
CMD ["node", "server.mjs"]

FROM node:${NODE_VERSION} AS agent_runner_deps
WORKDIR /app
COPY sdk/package.json ./sdk/package.json
COPY sdk/tsconfig.json ./sdk/tsconfig.json
COPY sdk/src ./sdk/src
WORKDIR /app/sdk
RUN npm install --ignore-scripts \
    && npm run build \
    && npm prune --omit=dev
COPY agent_scripts/package.json /app/agent_scripts/package.json
WORKDIR /app/agent_scripts
RUN npm install --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM node:${NODE_VERSION} AS agent_runner
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=agent_runner_deps /app/sdk ./sdk
COPY --from=agent_runner_deps /app/agent_scripts/node_modules ./agent_scripts/node_modules
COPY agent_scripts/package.json ./agent_scripts/package.json
COPY agent_scripts/tsconfig.json ./agent_scripts/tsconfig.json
COPY agent_scripts/e2e_runner.ts ./agent_scripts/e2e_runner.ts
WORKDIR /app/agent_scripts
CMD ["npm", "run", "run:e2e"]
