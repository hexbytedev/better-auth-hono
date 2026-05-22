##############################
# ---------- Base ---------- #
##############################
FROM oven/bun:1.3.14 AS base

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
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
# ------- Migration ------- #
##############################
FROM base AS migrate
COPY . .
CMD ["bunx", "drizzle-kit", "push"]

##############################
# --------- Runner --------- #
##############################
FROM oven/bun:1.3.14 AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built assets from builder
COPY --from=builder /app/dist ./dist

# Use non-root user
USER bun

# Expose port
EXPOSE 8558

# Start the application
CMD ["bun", "dist/index.js"]
