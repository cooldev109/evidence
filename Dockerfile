# EVIDENCE — API image
# Multi-stage build keeps the runtime image lean while preserving the pnpm
# workspace symlinks (apps/api depends on packages/* via workspace:* protocol).

FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

# ---- dependencies (cached when lockfile + package.json files don't change) ----
# Copy every workspace manifest so pnpm installs deps for ALL packages.
# Adding a new package means adding its package.json line here.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/
COPY packages/tsa/package.json ./packages/tsa/
COPY packages/storage/package.json ./packages/storage/
COPY packages/pdf/package.json ./packages/pdf/
COPY packages/verify/package.json ./packages/verify/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production

# Bring over the entire installed tree (root + every workspace package's
# node_modules + pnpm symlinks) in one shot, then overlay the source. This is
# robust to new packages: a new workspace package's node_modules comes along
# automatically without editing a per-package COPY list.
COPY --from=deps /app ./
COPY apps ./apps
COPY packages ./packages

# Drop privileges
RUN mkdir -p /app/.evidence-store && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@evidence/api", "start"]
