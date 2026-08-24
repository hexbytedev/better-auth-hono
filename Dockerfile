##############################
# ---------- Base ---------- #
##############################
FROM oven/bun:1.4.0 AS base

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies (includes drizzle-kit, used for DB migrations)
RUN bun install --frozen-lockfile

##############################
# --------- Builder -------- #
##############################
FROM base AS builder

# Copy source code
COPY . .

# Build the application
RUN bun run build

##############################
# --------- Runner --------- #
# Single image: serves the app by default, and can also run database
# migrations (`migrate`) or a schema push (`push`) via the entrypoint.
##############################
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production

# Built application bundle
COPY --from=builder /app/dist ./dist

# Files drizzle-kit needs: migration SQL + config (for `migrate`) and the
# schema (for `push`). node_modules (incl. drizzle-kit) come from the base stage.
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src/db/schema.ts ./src/db/schema.ts

# Entrypoint dispatches between: app (default) | migrate | push
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Use non-root user
USER bun

# Expose port
EXPOSE 8558

# Default: start the app. Override the command with `migrate` or `push`.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["app"]
