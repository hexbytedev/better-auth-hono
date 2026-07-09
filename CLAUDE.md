# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A detailed `AGENTS.md` already exists with code-style rules, env-var conventions, and a strict `.gitignore` access denylist (never read `.env*` except `.env.sample` / `.env.example`). Read it for conventions; this file covers commands and the big-picture architecture.

## Commands

Runtime is **Bun** (not Node). All scripts run through Bun.

- Install: `bun install`
- Dev (hot reload): `bun run dev`
- Build: `bun run build` (bundles `src/index.ts` into `dist/`); run with `bun run start`
- Lint: `bun run lint` (Biome check + autofix) / `bun run lint:check` (no writes, used in CI)
- Format: `bun run format`
- Tests: `bun run test` — single file `bun test src/index.smoke.test.ts` — single name `bun test -t "application smoke tests"`
- DB schema: `bun run push` syncs `src/db/schema.ts` straight to the DB (used for setup and updates, including a fresh database;
  interactive — prompts before a change it can't apply automatically, so it needs a TTY). `bun run generate` optionally records the
  change as versioned SQL in `drizzle/`. `bun run studio` opens Drizzle Studio.

`drizzle.config.ts` loads `.env.local` directly (not `dotenv/config`), so Drizzle commands need `DATABASE_URL` in `.env.local`. CI (`.github/workflows/ci.yml`) runs `lint:check`, `build`, `test`, and `bun audit --audit-level=high`. A pre-commit Husky hook runs `bun run lint`.

## Architecture

This is a deployable Better-Auth authentication server wrapped in Hono. The design principle (see README) is to keep Better-Auth itself unmodified and put all customization in the integration layer around it.

### Boot sequence (`src/index.ts`)

Import order is load-bearing and commented as such:

1. `import "dotenv/config"` first — populates `process.env`.
2. Sentry init second — reads `SENTRY_*` directly from `process.env`.
3. Everything else after, then `checkEnv()` runs **before** the server starts.

`checkEnv()` is the fail-fast gate. Env helpers in `src/lib/env.ts` (`requireEnv` / `envWithDefault` / `optionalEnv`) must be called at **module scope** so that missing `requireEnv` vars are accumulated into a single set and reported together by `checkEnv()` at startup. Calling them inside request handlers defeats this. See `AGENTS.md` for the three-place process when adding a new env var.

### Auth core (`src/auth.ts`)

The single `betterAuth({...})` config object is the heart of the app. Key patterns:

- **Feature flags via env presence.** Social providers (Google/GitHub) and email/password are conditionally spread into the config based on whether their env vars are set (`...(isGoogleEnabled && {...})`, `...(EMAIL_PASSWORD_ENABLED && {...})`). Email OTP is opt-in via `EMAIL_OTP_ENABLED=true`. This means the active auth surface depends entirely on configured env.
- **`hooks.before`** runs fraud screening on `/sign-up/email` when `FRAUD_CHECK_API_URL` is set (optional): checks the email then the client IP. The email check is **fail-closed**: the remote must return HTTP 200 (allowed) or the signup is blocked with `APIError`, and if the API is unreachable/errors the signup is also blocked. The client IP is a secondary signal that only blocks on an explicit threat verdict (otherwise fail-open). IPs/emails are masked before logging.
- **`hooks.after`** fetches and reconciles a GitHub user's verified emails into the `user_emails` table after OAuth sign-in (insert, update flags, prune stale/noreply rows), each step wrapped in its own try/catch + Sentry capture.
- **Plugins**: `expo`, `openAPI` (default reference page disabled via `disableDefaultReference: true`; its schema at `/api/auth/open-api/generate-schema` is rendered instead by the unified `/api/docs` Scalar page in `index.ts`), `passkey` (auto-names credentials from the authenticator AAGUID via `getAuthenticatorName`), `twoFactor` (TOTP `issuer` set from `TOTP_ISSUER_NAME`), `jwt`, and conditionally `emailOTP`. The `jwt` plugin's `definePayload` enriches tokens with DB-derived claims (`isTwoFactorEnabled`, `isCredentialBased`) for downstream microservices.
- Better-Auth's default model names are remapped to the custom Drizzle tables (`users`, `sessions`, `accounts`, etc.) and `generateId: false` so IDs come from the schema's UUIDv7 defaults.

### Database (`src/db/`)

Drizzle ORM over `pg` Pool. `schema.ts` defines all tables with UUIDv7 primary keys (`$defaultFn(() => uuidv7())`) and explicit indices tuned for lookups. Better-Auth's required tables live here alongside the custom `user_emails` table. Edit `schema.ts`, then `generate` + `push`.

### Internal user API (`src/routes/users.route.ts` + `src/services/user.service.ts`)

A custom Basic-Auth-protected lookup API: `GET /api/users/id/:id` and `POST /api/users/email`. These routes are **conditionally mounted** in `index.ts` — only when both `API_AUTH_USER` and `API_AUTH_PASSWORD` are set (`isBasicAuthEnabled`). When disabled, the paths return 503. The service layer shapes responses through `UserResponseSchema` to avoid leaking sensitive columns (passwords, tokens) — routes never return raw DB rows.

### Middleware (`src/middleware/api-key.middleware.ts`)

`validateBasicAuth` uses `timingSafeEqual` (via `safeCompare`) for credential comparison. An optional IP whitelist (`API_ALLOWED_IPS`, comma-separated, supports CIDR) is layered on top of Basic Auth when configured — it does not work without Basic Auth enabled. Client IPs come from `getClientIP()`, which reads the unspoofable TCP socket address and only trusts `X-Real-IP` / `X-Forwarded-For` when the connection originates from a `TRUSTED_PROXIES` entry (exact IP or CIDR, IPv4 or IPv6, matched via `ipaddr.js`). The reverse proxy is the trust boundary; for Cloudflare deployments nginx restores the real visitor IP and forwards it as `X-Real-IP` (see "Running behind nginx / Cloudflare" in the README).

### Email (`src/lib/email.ts`)

All transactional email goes through Resend. The `Resend` client is constructed lazily in `getResend()` (not at module load) so the module can import before `checkEnv()` validates `RESEND_API_KEY`. All user-supplied values are HTML-escaped before templating.

### Config & redaction

- `src/config/app.config.ts` centralizes CORS origins (`getAllowedOrigins`), port/host parsing with validation, and reads `CLIENT_URL`.
- `src/lib/redaction.ts` provides `maskEmail` (and IP masking lives in `auth.ts`) — used everywhere before logging PII to console or Sentry.

## Testing

`src/index.smoke.test.ts` boots the real app via dynamic `import("./index")`, injecting a full fake env and clearing optional keys to exercise the disabled-feature paths (Basic Auth off → 503, etc.). When adding tests that import `index.ts` or `auth.ts`, replicate this env setup or those modules will fail `checkEnv()` / `requireEnv`.

## Deployment

A single Docker image `better-auth-hono` serves the app and sets up the DB schema. `docker-entrypoint.sh` dispatches on the container
command: default/`app` starts the server, `push` syncs `src/db/schema.ts` into the database. The `runner` stage builds from `base` so
`drizzle-kit` and the `drizzle/` files are present. See `Dockerfile`, `docker-compose.yml` (runs the same image twice — a `push` one-shot
the app depends on), and the `build-and-push.yml` workflow (builds on tag push / manual dispatch). Do not hand-edit `dist/`.
