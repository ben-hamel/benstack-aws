FROM oven/bun:1 AS builder
WORKDIR /app

# Copy root manifests
COPY package.json bun.lock ./

# Copy workspace package manifests
COPY apps/server/package.json ./apps/server/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/env/package.json ./packages/env/

# Install all dependencies
RUN bun install

# Copy source
COPY tsconfig.json ./
COPY apps/server/src ./apps/server/src
COPY apps/server/tsdown.config.ts ./apps/server/
COPY packages/auth/src ./packages/auth/src
COPY packages/config/tsconfig.base.json ./packages/config/
COPY packages/db/src ./packages/db/src
COPY packages/env/src ./packages/env/src

# Build — tsdown bundles all workspace deps into a single index.mjs
RUN cd apps/server && bun run build

# ── Migrate ───────────────────────────────────────────────────────────────────
FROM oven/bun:1 AS migrate
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/db/package.json ./packages/db/
COPY packages/env/package.json ./packages/env/
COPY packages/config/package.json ./packages/config/

RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY packages/db/drizzle.config.ts ./packages/db/
COPY packages/db/src/migrations ./packages/db/src/migrations

WORKDIR /app/packages/db
CMD ["bun", "run", "db:push"]

# ── Runner ────────────────────────────────────────────────────────────────────
FROM oven/bun:1-slim AS runner
WORKDIR /app

COPY --from=builder /app/apps/server/dist ./

EXPOSE 3000
CMD ["bun", "run", "index.mjs"]
