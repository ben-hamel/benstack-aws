ARG BUN_VERSION=1.3.9

# ── Base ──────────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION} AS base
WORKDIR /app
COPY . .

# ── Pruners ───────────────────────────────────────────────────────────────────
FROM base AS pruner-server
RUN bunx turbo prune server --docker

FROM base AS pruner-db
RUN bunx turbo prune @benstack-aws/db --docker

# ── Builder ───────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION} AS builder
WORKDIR /app
COPY --from=pruner-server /app/out/json/ .
COPY --from=pruner-server /app/out/bun.lock ./bun.lock
RUN bun install --frozen-lockfile
COPY --from=pruner-server /app/out/full/ .
RUN cd apps/server && bun run build

# ── Migrate ───────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION} AS migrate
WORKDIR /app
COPY --from=pruner-db /app/out/json/ .
COPY --from=pruner-db /app/out/bun.lock ./bun.lock
RUN bun install --frozen-lockfile
COPY --from=pruner-db /app/out/full/ .
WORKDIR /app/packages/db
CMD ["bun", "run", "db:push"]

# ── Runner ────────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-slim AS runner
RUN apt-get update && apt-get install -y postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/apps/server/dist ./
EXPOSE 3000
CMD ["bun", "run", "index.mjs"]
