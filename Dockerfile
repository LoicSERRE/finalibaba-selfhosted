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
RUN corepack enable
# postgresql16-client: matches the postgres:16-alpine server exactly - used by
# app/api/backup/route.ts (pg_dump/psql) for in-app backup & restore
RUN apk add --no-cache libc6-compat postgresql16-client
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Production-only deps (excludes TypeScript, ESLint, Tailwind, @types/* - ~half the size)
# --ignore-scripts: same reason as the deps stage - schema isn't copied in yet,
# and the generated client is copied in from the builder stage below anyway.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# App runtime
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/app/generated ./app/generated

# Prisma migrations (needed at startup)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000

# Run migrations then start the app
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm start"]
