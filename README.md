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
- Sign up fraud protection: when `FRAUD_CHECK_API_URL` is configured, each registration's email must be explicitly allowed by the [DeGhost fraud detection API](https://deghost.hexbyte.dev) (API endpoint: <https://deghostapi.hexbyte.dev>) or the signup is blocked (fail-closed); the client IP is additionally screened for disposable/abusive sources and threat signals.

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
- Sign up fraud screening runs only when `FRAUD_CHECK_API_URL` is set (the [DeGhost fraud detection API](https://deghost.hexbyte.dev), endpoint <https://deghostapi.hexbyte.dev>). It is **fail-closed on the email**: the remote must explicitly allow the email (HTTP 200) or the signup is blocked, including when the API is unreachable or returns an error. The client IP is a secondary signal (proxy/VPN and threat checks) that blocks only on an explicit threat verdict.
- Fraud screening covers only the email/password signup (`/sign-up/email`); social (Google/GitHub) signup is intentionally unscreened because the OAuth provider is responsible for handling fraudulent/abusive accounts.
- Email OTP is opt-in (`EMAIL_OTP_ENABLED=true`) and sign-in only (`disableSignUp`, so it cannot create accounts), with configurable expiry and hashed OTP storage.
- Basic Auth middleware protects internal endpoints and uses timing-safe comparisons.
- `/api/users/*` routes are mounted only when both `API_AUTH_USER` and `API_AUTH_PASSWORD` are configured.

### Running behind nginx / Cloudflare

`getClientIP()` treats the reverse proxy as the trust boundary: it reads the unspoofable TCP socket address and only honors the `X-Real-IP` / `X-Forwarded-For` headers when the connection originates from a `TRUSTED_PROXIES` entry (exact IP or CIDR, IPv4 or IPv6). Set `TRUSTED_PROXIES` to the address the app actually sees the proxy connect from (for a co-located nginx that is usually `127.0.0.1` and/or `::1`).

When the app runs behind **Cloudflare → nginx → app**, let nginx restore the real visitor IP from Cloudflare's `CF-Connecting-IP` header but only trust that header from Cloudflare's published edge ranges and forward it to the app as `X-Real-IP`. The app then trusts nginx (via `TRUSTED_PROXIES`), and nginx is the single place responsible for deriving the real IP.

```nginx
# /etc/nginx/conf.d/cloudflare-real-ip.conf
# Restore the real client IP from Cloudflare, trusting CF-Connecting-IP
# ONLY from Cloudflare's edge ranges (keep this list in sync with
# https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6).
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

real_ip_header CF-Connecting-IP;   # $remote_addr becomes the true visitor IP


# server block for Cloudflare → nginx → app
# /etc/nginx/conf.d/better-auth-hono.conf
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name auth.example.com;

    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass         http://10.0.0.2:8558;
        proxy_http_version 1.1;

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;      # restored client IP from CF-Connecting-IP
        proxy_set_header   X-Forwarded-For   $remote_addr;      # single trusted hop
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Forwarded-Host  $host;
        proxy_set_header   X-Forwarded-Port  $server_port;
    }
}
```

With this in place, set `TRUSTED_PROXIES=127.0.0.1` (and `::1` if nginx dials the app over IPv6). Without Cloudflare, drop the `set_real_ip_from` / `real_ip_header` block and keep the `server { … }` section; nginx sets `X-Real-IP` from its own `$remote_addr`.

### Development notes

- Keep customizations outside Better-Auth internals to preserve upgradability.

License: [MIT](LICENSE)
