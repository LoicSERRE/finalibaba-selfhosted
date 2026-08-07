# ── deps ───────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
# corepack ships with Node 22 - this pulls the exact pnpm version pinned in
# package.json's "packageManager" field, so every stage (and CI) resolves
# packages identically.
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: prisma/schema.prisma isn't copied into this stage, so the
# postinstall `prisma generate` would fail here. The builder stage below runs
# its own explicit `prisma generate` once the full source is present.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ── builder ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client from schema (no DB connection needed)
RUN pnpm exec prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm run build

# ── runner ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
# postgresql16-client: matches the postgres:16-alpine server exactly - used by
# app/api/backup/route.ts (pg_dump/psql) for in-app backup & restore
RUN corepack enable && apk add --no-cache libc6-compat postgresql16-client
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Production-only deps (excludes TypeScript, ESLint, Tailwind, @types/* - ~half the size)
# --ignore-scripts: same reason as the deps stage - schema isn't copied in yet,
# and the generated client is copied in from the builder stage below anyway.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
# pnpm's own content-addressable store (/root/.cache/pnpm) is a package-
# resolution/dedup cache from installing - useful for a *repeated* local
# install, meaningless once the packages are already unpacked into
# node_modules below, and never read at runtime. Left in place it was 410MB
# of npm-registry metadata JSON sitting in the production image - which
# Trivy's secret scanner then has to read through on every release scan,
# slow enough (several large multi-MB .jsonl files) to occasionally exceed
# its 5-minute default timeout and abort the whole scan with a generic,
# hard-to-diagnose "context deadline exceeded" failure that looks like a
# real finding but isn't. Do NOT remove /root/.cache/node/corepack next to
# it though - that one *is* needed at runtime (it's corepack's actual cached
# pnpm binary, ~38MB; without it every container start would need a network
# fetch from the npm registry just to run `pnpm start`).
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    rm -rf /root/.cache/pnpm /tmp/node-compile-cache

# App runtime
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/app/generated ./app/generated

# Prisma migrations (needed at startup)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# node:22-alpine bundles npm (and its own vendored node_modules) even though
# this project only ever uses pnpm (see corepack enable above) - npm/npx are
# never invoked anywhere in this Dockerfile or its CMD. Trivy flags real
# CVEs in npm's bundled deps (tar, brace-expansion, picomatch, sigstore) on
# every release scan for code that's genuinely unreachable here, not just
# unlikely to be reached - removing it outright is more honest than
# suppressing the finding, and slightly shrinks the image too.
# Drop root before the app runs - node:22-alpine already ships a non-root
# "node" user (uid 1000). chown -R covers everything above in a single pass,
# including node_modules (produced by the `pnpm install` RUN step, not a
# COPY, so a per-COPY --chown wouldn't reach it).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx && \
    chown -R node:node /app
USER node

EXPOSE 3000

# Run migrations then start the app
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm start"]
