# Better-Auth Hono - Production-ready Auth Server

This repository packages Better-Auth into a focused, deployable Docker image that delivers a complete authentication service (passkeys, TOTP, JWTs, social OAuth, email/password, email OTP, and an internal lookup API) with pragmatic operational defaults applied.

## Why this project

- Provides ready-to-run Docker images that are easy to deploy and configure via `.env.local`.
- Environment-first validation, Sentry integration, sensible CORS/cookie settings, and schema/indexing tuned for Postgres.
- Keeps Better-Auth itself unchanged - improvements live around the integration surface for safety and portability.

## What you get

- Runtime and migration Docker images, runnable on any container platform (see `Dockerfile` and `docker-compose.yml`).
- Drizzle ORM schema with UUID primary keys and indices optimized for fast lookups (see `src/db/schema.ts`).
- JWT support for microservices (`src/auth.ts`) and an internal Basic-Auth protected user lookup API (`GET /api/users/id/:id`, `POST /api/users/email`).
- Email OTP authentication: sign-in, email verification, password reset, and email change via one-time codes.
- Sign up fraud protection: during registration, emails and IP addresses are checked against the [DeGhost fraud detection API](https://deghost.hexbyte.dev) (API endpoint: https://deghostapi.hexbyte.dev) to block disposable emails, known abusive domains, and suspicious IPs.

## Features at a Glance

| Feature | Description | Included |
| :--- | :--- | :---: |
| **Passkeys** | Modern WebAuthn/Biometric authentication | ✅ |
| **Two-Factor (2FA)** | Multi-factor authentication via TOTP | ✅ |
| **Social OAuth** | Login via Google and GitHub providers | ✅ |
| **Email & Password** | Traditional credentials with verification & reset | ✅ |
| **Email OTP** | Sign-in, verification, and password reset via one-time codes | ✅ |
| **JWT Support** | Stateless tokens for microservice authentication | ✅ |
| **Internal User API** | **Custom** Basic-Auth protected lookup by ID and email | ✅ |
| **Signup Protection** | **Custom** Fraud checks for email and IP | ✅ |
| **OpenAPI/Swagger** | Automated API documentation and reference | ✅ |
| **Docker Support** | Optimized production-ready container images | ✅ |
| **Database ORM** | Drizzle with UUID v7 and optimized indexing | ✅ |
| **Sentry Monitoring** | Structured error tracking and performance metrics | ✅ |
| **Code Quality** | Biome linting/formatting and Husky git hooks | ✅ |

## Better Auth Plugins in Use

| Plugin | Import | Configurable |
| :--- | :--- | :---: |
| **Expo** | `@better-auth/expo` | Always |
| **Email OTP** | `better-auth/plugins` | `EMAIL_OTP_ENABLED` |
| **OpenAPI** | `better-auth/plugins` | Always |
| **Passkey** | `@better-auth/passkey` | Always |
| **Two-Factor (2FA)** | `better-auth/plugins` | Always |
| **JWT** | `better-auth/plugins` | Always |

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

### Tests

- `bun run test`
- `bun test src/index.smoke.test.ts`

### Database / migrations

- `bun run generate`
- `bun run push`
- `drizzle.config.ts` loads `.env.local`, so Drizzle commands use that file for `DATABASE_URL`.

### Code quality

This project uses Husky for Git hooks to ensure code quality:

- **Pre-commit hook**: Runs `bun run lint` before each commit.

To manually run linting and formatting:

- `bun run lint` - Lint and auto-fix issues
- `bun run lint:check` - Check for issues without fixing
- `bun run format` - Format code

GitHub pull requests also run:

- `bun run lint:check`
- `bun run build`
- `bun run test`
- `bun audit --audit-level=high`

### Key files

- `src/index.ts` - app bootstrap, CORS, mounts Better-Auth and internal routes.
- `src/auth.ts` - Better-Auth configuration, plugins, hooks, drizzle adapter, email callbacks.
- `src/lib/email.ts` - Email delivery via Resend (verification, password reset, OTP, email change).
- `src/db/schema.ts` - Drizzle schema and indices.
- `src/routes/users.route.ts` - Basic-Auth protected internal user lookup (`GET /api/users/id/:id`, `POST /api/users/email`).

### Security & operations

- Fail-fast env validation prevents accidental misconfiguration.
- Sentry captures structured errors with tags for faster triage.
- Sign up hooks consult the [DeGhost fraud detection API](https://deghost.hexbyte.dev) (API endpoint: https://deghostapi.hexbyte.dev) to screen registrations — emails are checked against known disposable / abusive domains, and IPs are checked for proxy/VPN and threat signals.
- Email OTP is opt-in (`EMAIL_OTP_ENABLED=true`) with configurable expiry and hashed OTP storage.
- Basic Auth middleware protects internal endpoints and uses timing-safe comparisons.
- `/api/users/*` routes are mounted only when both `API_AUTH_USER` and `API_AUTH_PASSWORD` are configured.

### Development notes

- Keep customizations outside Better-Auth internals to preserve upgradability.

License: [MIT](LICENSE)
