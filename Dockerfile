# ── deps ───────────────────────────────────────────────────────────────────────
FROM node:26-alpine AS deps
RUN apk add --no-cache libc6-compat
# Node 26 dropped bundling corepack by default (Node 22 shipped it out of the
# box) - install it explicitly via npm first. corepack's own version doesn't
# affect reproducibility, it's just the installer for the exact pnpm version
# pinned in package.json's "packageManager" field, so every stage (and CI)
# resolves packages identically regardless of which corepack fetched it.
RUN npm install -g corepack@latest && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: prisma/schema.prisma isn't copied into this stage, so the
# postinstall `prisma generate` would fail here. The builder stage below runs
# its own explicit `prisma generate` once the full source is present.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ── builder ────────────────────────────────────────────────────────────────────
FROM node:26-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN npm install -g corepack@latest && corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client from schema (no DB connection needed)
RUN pnpm exec prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm run build

# ── runner ─────────────────────────────────────────────────────────────────────
FROM node:26-alpine AS runner
# postgresql16-client: matches the postgres:16-alpine server exactly - used by
# app/api/backup/route.ts (pg_dump/psql) for in-app backup & restore
RUN npm install -g corepack@latest && corepack enable && apk add --no-cache libc6-compat postgresql16-client
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Production-only deps (excludes TypeScript, ESLint, Tailwind, @types/* - ~half the size)
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
# Copied here, before the install below, for two reasons: this project's
# own package.json has a root "postinstall": "prisma generate" script that
# pnpm runs on every install unless scripts are ignored, which needs
# schema.prisma to exist to succeed - and prisma/prisma.config.ts are also
# needed at container startup for `prisma migrate deploy` regardless, so
# there's no reason to copy them a second time later in this stage.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# Run this install as the "node" user, not root - confirmed the hard way
# that running it as root breaks the container at every single startup, not
# just at build time. `pnpm install` invokes corepack, which fetches and
# caches the pinned pnpm binary into whoever's $HOME it's currently running
# as. As root that's /root/.cache/node/corepack - completely unreadable by
# the "node" user the container actually runs as (USER node below), since
# /root itself isn't traversable by other users. Every container start then
# re-downloaded pnpm from the npm registry from scratch just to run `pnpm
# exec prisma migrate deploy && pnpm start` - this is exactly what killed a
# real deploy (corepack's download got killed mid-fetch, exit 137, most
# likely OOM) instead of starting in the sub-second time a cache hit would
# take. Running the install as node instead makes the cache land under
# /home/node/.cache/node/corepack, exactly where the runtime USER can
# actually read it back - do NOT delete that path below, only pnpm's own
# store.
RUN chown node:node /app
USER node
# pnpm's own content-addressable store (now under /home/node/.cache/pnpm,
# since this whole step runs as node) is a package-resolution/dedup cache
# from installing - useful for a *repeated* local install, meaningless once
# the packages are already unpacked into node_modules below, and never read
# at runtime. Left in place it was 410MB of npm-registry metadata JSON
# sitting in the production image - which Trivy's secret scanner then has to
# read through on every release scan, slow enough (several large multi-MB
# .jsonl files) to occasionally exceed its 5-minute default timeout and
# abort the whole scan with a generic, hard-to-diagnose "context deadline
# exceeded" failure that looks like a real finding but isn't.
#
# No --ignore-scripts here (unlike deps/builder, where it's needed because
# schema.prisma isn't copied in yet): this install must run @prisma/engines'
# own postinstall (pnpm-workspace.yaml's allowBuilds already allow-lists it),
# which downloads and chmod +x's the schema-engine binary `prisma migrate
# deploy` needs at container startup - that binary is separate from the
# query engine bundled into app/generated/prisma by the builder stage's own
# `prisma generate`, so copying the generated client here does NOT cover it.
# Skipping this postinstall left every release silently depending on `prisma
# migrate deploy` re-downloading schema-engine over the network on every
# single container start instead of it being baked into the image - fine
# until one such download raced or got interrupted, which surfaced as
# `spawn schema-engine-linux-musl-openssl-3.0.x EACCES` on an otherwise
# healthy deploy (confirmed empirically: the binary was completely absent
# from a published image, and manually re-running @prisma/engines' own
# scripts/postinstall.js on that same image produced a correctly
# permissioned -rwxr-xr-x file).
RUN pnpm install --frozen-lockfile --prod
USER root

# App runtime
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/app/generated ./app/generated
# prisma/ and prisma.config.ts (needed at startup for `prisma migrate
# deploy`) were already copied in above, ahead of the pnpm install step.

# node:26-alpine bundles npm (and its own vendored node_modules) even though
# this project only ever uses pnpm - npm's only real use anywhere in this
# Dockerfile is the one-shot `npm install -g corepack` above (Node 26 no
# longer bundles corepack itself, unlike Node 22), never invoked again after
# that. Trivy flags real CVEs in npm's bundled deps (tar, brace-expansion,
# picomatch, sigstore) on every release scan for code that's genuinely
# unreachable at runtime, not just unlikely to be reached - removing it
# outright once corepack has already pulled the pinned pnpm version is more
# honest than suppressing the finding, and slightly shrinks the image too.
# Drop root before the app runs - node:26-alpine already ships a non-root
# "node" user (uid 1000). node_modules is already node-owned (that RUN step
# above now runs as node itself), but every COPY --from=builder above this
# point defaults to root ownership regardless of the currently active USER -
# this chown -R is what makes .next/public/generated/prisma readable by the
# node user that actually runs the app. The /home/node/.cache/pnpm and
# /tmp/node-compile-cache cleanup (see the pnpm install step above for why
# they're safe to delete) has to happen here as root, not inside that step
# while running as node: /tmp/node-compile-cache also picks up root-owned
# entries from the earlier `npm install -g corepack` step in this same
# stage (same Node version -> same cache directory), and node can't remove
# files it doesn't own - confirmed the hard way, `rm -rf` as node partially
# failed on exactly those root-owned entries.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
           /home/node/.cache/pnpm /tmp/node-compile-cache && \
    chown -R node:node /app
USER node

EXPOSE 3000

# Run migrations then start the app
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm start"]
