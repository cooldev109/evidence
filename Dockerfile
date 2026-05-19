# EVIDENCE — API image
# Multi-stage build keeps the runtime image lean while preserving the pnpm
# workspace symlinks (apps/api depends on packages/* via workspace:* protocol).

FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

# ---- dependencies (cached when lockfile + package.json files don't change) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/
COPY packages/tsa/package.json ./packages/tsa/
COPY packages/storage/package.json ./packages/storage/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production

# Copy workspace symlinks + per-package node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/tsa/node_modules ./packages/tsa/node_modules
COPY --from=deps /app/packages/storage/node_modules ./packages/storage/node_modules

# Copy source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages

# Drop privileges
RUN mkdir -p /app/.evidence-store && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@evidence/api", "start"]
