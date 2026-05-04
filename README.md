# Better-Auth Hono - Production-ready Auth Server

This repository packages Better-Auth into a focused, deployable Docker image that delivers a complete authentication service (passkeys, TOTP, JWTs, social OAuth, email/password, and an internal lookup API) with pragmatic operational defaults applied.

## Why this project

- Provides a ready-to-run Docker image that’s easy to deploy and configure via `.env.local`.
- Environment-first validation, Sentry integration, sensible CORS/cookie settings, and schema/indexing tuned for Postgres.
- Keeps Better-Auth itself unchanged - improvements live around the integration surface for safety and portability.

## What you get

- Single Docker image, runnable on any container platform (see `Dockerfile` and `docker-compose.yml`).
- Drizzle ORM schema with UUID primary keys and indices optimized for fast lookups (see `src/db/schema.ts`).
- JWT support for microservices (`src/auth.ts`) and an internal Basic‑Auth protected user lookup API (`/api/users/*`).
- Sign up fraud mitigation: domain/email/IP checks against an external fraud service to reduce abuse.

## Features at a Glance

| Feature | Description | Included |
| :--- | :--- | :---: |
| **Passkeys** | Modern WebAuthn/Biometric authentication | ✅ |
| **Two-Factor (2FA)** | Multi-factor authentication via TOTP | ✅ |
| **Social OAuth** | Login via Google and GitHub providers | ✅ |
| **Email & Password** | Traditional credentials with verification & reset | ✅ |
| **JWT Support** | Stateless tokens for microservice authentication | ✅ |
| **Internal User API** | **Custom** Basic-Auth protected lookup (ID/Email) | ✅ |
| **Signup Protection** | **Custom** Fraud checks for Email, Domain, and IP | ✅ |
| **OpenAPI/Swagger** | Automated API documentation and reference | ✅ |
| **Docker Support** | Optimized production-ready container images | ✅ |
| **Database ORM** | Drizzle with UUID v7 and optimized indexing | ✅ |
| **Sentry Monitoring** | Structured error tracking and performance metrics | ✅ |
| **Code Quality** | Biome linting/formatting and Husky git hooks | ✅ |

## Deployment to the production cloud

- Copy `.env.sample` to `.env.local` and fill in secrets.
- Docker compose: use the provided `docker-compose.yml` as a starting point.
- `ghcr.io/hexbytedev/better-auth-hono-migrate:<version>` is required only for running migrations.
- `ghcr.io/hexbytedev/better-auth-hono:<version>` is the lightweight main app image without any dev dependencies.

## For developers

### Run locally (hot reload)

- `bun install`
- `bun run dev`

### Build and run (production)

- `bun run build`
- `bun run start`

### Code quality

This project uses Husky for Git hooks to ensure code quality:

- **Pre-commit hook**: Automatically runs `biome check --write` to lint and format code before each commit
- **Commit-msg hook**: Validates commit messages (minimum 10 characters)

To manually run linting and formatting:
- `bun run lint` - Lint and auto-fix issues
- `bun run lint:check` - Check for issues without fixing
- `bun run format` - Format code

### Key files

- `src/index.ts` - app bootstrap, CORS, mounts Better-Auth and internal routes.
- `src/auth.ts` - Better-Auth configuration, plugins, hooks, drizzle adapter, email callbacks.
- `src/db/schema.ts` - Drizzle schema and indices.
- `src/routes/users.route.ts` - Basic‑Auth protected internal user lookup.

### Security & operations

- Fail-fast env validation prevents accidental misconfiguration.
- Sentry captures structured errors with tags for faster triage.
- Sign up hooks consult a fraud-check API to block suspicious registrations.
- Basic Auth middleware protects internal endpoints and uses timing‑safe comparisons.

### Development notes

- Keep customizations outside Better-Auth internals to preserve upgradability.

License: [MIT](LICENSE)
