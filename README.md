# Better-Auth Hono - Production-ready Auth Server

> [!TIP]
> **Live demo: no deployment required.** Try the full login process at **[authtry.hexbyte.dev](https://authtry.hexbyte.dev)**.

This repository packages Better-Auth into a focused, deployable Docker image that delivers a complete authentication service (passkeys, TOTP, JWTs, social OAuth, email/password, email OTP, and an internal lookup API) with pragmatic operational defaults applied.

## Why this project

- Provides ready-to-run Docker images that are easy to deploy and configure via `.env.local`.
- Environment-first validation, Sentry integration, sensible CORS/cookie settings, and schema/indexing tuned for Postgres.
- Keeps Better-Auth itself unchanged - improvements live around the integration surface for safety and portability.

## What you get

- Runtime and migration Docker images, runnable on any container platform (see `Dockerfile` and `docker-compose.yml`).
- Drizzle ORM schema with UUID primary keys and indices optimized for fast lookups (see `src/db/schema.ts`).
- JWT support for microservices (`src/auth.ts`) and an internal Basic-Auth protected user lookup API (`GET /api/users/id/:id`, `POST /api/users/email`).
- Email OTP authentication: sign-in, email verification, and password reset via one-time codes.
- Sign up fraud protection: when `FRAUD_CHECK_API_URL` is configured, each registration's email must be explicitly allowed by the [DeGhost fraud detection API](https://deghost.hexbyte.dev) (API endpoint: <https://deghostapi.hexbyte.dev>) or the signup is blocked (fail-closed); the client IP is additionally screened for disposable/abusive sources and threat signals. Optionally, sign-ups from public/free email providers (gmail.com, etc.) can be rejected via `BLOCK_PUBLIC_DOMAIN_SIGNUP`, which is handy for B2B apps that only accept organization email.

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
| **Signup Protection** | **Custom** Fraud checks for email, IP, and public-domain policy | ✅ |
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

## Deploy with Docker

A single prebuilt image `ghcr.io/hexbytedev/better-auth-hono:<version>` both serves the app and sets up the database schema. Choose the mode via the container command:

- **no command** (or `app`) → starts the auth server (default).
- `push` → syncs `src/db/schema.ts` into the database, then exits. Run it once per deploy/upgrade (the compose file does this for you).

To set up (or update) the schema as a one-shot job:

```bash
docker run --rm --env-file .env.local ghcr.io/hexbytedev/better-auth-hono:<version> push
```

On a new/empty database this applies the whole schema and exits cleanly. When `push` meets a change it will not apply automatically
(e.g. a destructive change against existing data) it **prompts for confirmation**, which needs an interactive terminal. Run it from inside a running container instead:

```bash
# open a shell in the running app container (its name from docker-compose.yml is better-auth-hono)
sudo docker exec -it better-auth-hono /bin/sh

# then, inside the container, run push and answer its prompts:
bun run push
```

The container already has `DATABASE_URL` (from the compose `env_file`), `drizzle-kit`, and the schema, so `push` connects and prompts right there.

### 1. Provision dependencies

- A **PostgreSQL** database (its connection string becomes `DATABASE_URL`).
- A **Resend** account with a verified sender domain (for transactional email).

### 2. Configure the environment

Copy `.env.sample` to `.env.local` and fill it in. Every variable is documented inline in `.env.sample`, and the server validates them at boot.
It **fails fast and lists everything missing** if a required variable is absent, so a bad config never starts silently.

Required in every deployment:

| Variable | Purpose |
| :--- | :--- |
| `BETTER_AUTH_SERVER_URL` | Public base URL of this auth server (OAuth callbacks, JWT issuer). |
| `BETTER_AUTH_SECRET` | Signing/encryption secret generated with `openssl rand -base64 32`. |
| `BETTER_AUTH_RP_ID` | WebAuthn relying-party ID: domain without scheme (e.g. `client-frontend.example.com`, or `localhost` in dev). |
| `BETTER_AUTH_RP_NAME` | Human-readable app name shown in passkey prompts. |
| `CLIENT_URL` | Frontend URL used as a CORS origin and the JWT audience. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `RESEND_API_KEY` | Resend API key for sending email. |
| `EMAIL_FROM` | Verified "from" address for outgoing email (a plain address, e.g. `no-reply@example.com`). The sender display name comes from `fromName` in the template folder's `config.json`. |

Everything else like social providers, email OTP, fraud checks, Sentry, cookie/CORS tuning etc. are **optional**
and activates only when its env vars are present.

### 3. Set up the schema, then start

With the provided `docker-compose.yml` the ordering is handled for you: the schema-setup service (the same image invoked with the `push` command)
runs to completion (`service_completed_successfully`) before the app starts. Update the image tags to the version you want, then:

```bash
docker compose up
```

Once running, `GET /api/health` returns `{ "status": "ok", ... }` for load-balancer / container health checks.
A single interactive API reference is served at `/api/docs` (Scalar): it always lists all Better-Auth endpoints (auto-generated by the `openAPI()` plugin),
and when the internal user API is enabled, it adds the Basic-Auth lookup API as a second source.

### 4. (Optional) Use your own email templates

By default the server sends the built-in English templates (the image contains them in `/app/templates/email`). The easiest way to use your own design is a **mounted folder**: you edit the files on the server and restart, with no image rebuild.

**Recommended: mount a folder.**

1. Put your templates in a folder next to `docker-compose.yml`. To start from the built-in ones, copy them out of the image (once):

   ```bash
   docker create --name tpl-seed ghcr.io/hexbytedev/better-auth-hono:<version>
   docker cp tpl-seed:/app/templates/email ./email-templates
   docker rm tpl-seed
   ```

   Or unzip a design you were given into `./email-templates`. The rules for editing are in `templates/email/README.md`. Any file you leave out of the folder keeps the built-in version.

2. Mount it in `docker-compose.yml`, on the `better-auth-hono` service (the lines are already there, commented out):

   ```yaml
   volumes:
     - ./email-templates:/app/email-templates:ro
   ```

3. Tell the server where it appears inside the container, in `.env.local`:

   ```bash
   EMAIL_TEMPLATES_DIR=/app/email-templates
   ```

4. Make the folder readable by the container user (it runs as non-root `bun`): `chmod -R a+rX ./email-templates`.
5. Start it: `docker compose up -d --force-recreate better-auth-hono`.

**Changing a template later:** edit the files in `./email-templates` on the server, then `docker compose restart better-auth-hono`. Templates are loaded once at startup, so a restart is always needed. If an edit breaks a template, the container refuses to start and, because of `restart: unless-stopped`, keeps retrying: read the reason with `docker logs better-auth-hono`, fix the file and restart again.

**Adjusting the path.** `EMAIL_TEMPLATES_DIR` is a path inside the container, never a path on your server. In `host-path:container-path`, change the left part to wherever the folder lives on your server (for example `/srv/mysite/email-templates:/app/email-templates:ro`). The right part must equal `EMAIL_TEMPLATES_DIR`. Use an absolute path.

**Check that it worked.** The startup log states what was loaded:

```text
[EMAIL] Using templates from /app/email-templates, overriding: layout.hbs, verification.hbs, config.json
```

- `[EMAIL] Using the built-in email templates`: `EMAIL_TEMPLATES_DIR` is not set.
- `[EMAIL] EMAIL_TEMPLATES_DIR (...) contains no template files`: the mount path and `EMAIL_TEMPLATES_DIR` do not match, or the host folder is empty.
- `EMAIL_TEMPLATES_DIR is not a directory`: the path does not exist inside the container, so the server stops.
- A message naming a file and a `{{variable}}`: a template broke the contract, so the server stops. See `templates/email/README.md`.

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

Scripts are run with **Bun** (this repo has no `yarn`/`db:*` scripts):

- `bun run push`: syncs `src/db/schema.ts` straight into the database. This is how the schema is set up and updated (including on a fresh database).
  It prompts before a change it will not apply automatically (e.g. one that risks existing data), so it needs a TTY.
- `bun run generate`: optionally record the change as versioned SQL in `drizzle/` for review/history.
- `drizzle.config.ts` loads `.env.local`, so Drizzle commands use that file for `DATABASE_URL`.

Typical schema change: edit `src/db/schema.ts` → `bun run generate` → `bun run push` (answer any prompts).

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
- `src/lib/email-templates.ts` + `templates/email/` - Handlebars template loader and the default email templates.
- `src/db/schema.ts` - Drizzle schema and indices.
- `src/routes/users.route.ts` - Basic-Auth protected internal user lookup (`GET /api/users/id/:id`, `POST /api/users/email`), defined with `@hono/zod-openapi` so it self-documents (its schema is served at `/api/users/openapi.json` and surfaced as a source in the unified `/api/docs` reference).

### Customizing email templates

Emails are rendered from [Handlebars](https://handlebarsjs.com) files in `templates/email/`, so each deployment can brand them without touching code.
Set `EMAIL_TEMPLATES_DIR` to a directory of your own (in Docker, see "4. (Optional) Use your own email templates" above).
Brand name, colors and copy live in the templates, not in env vars. A file missing from that directory falls back to the built-in one, so overriding only `layout.hbs` is enough to rebrand the shared shell.

| File | Purpose |
| :--- | :--- |
| `layout.hbs` | Shared HTML shell (branding, header, footer). Renders the `body` and `footer` blocks of each email. |
| `verification.hbs` | Sign-up email verification. |
| `password-reset.hbs` | Password reset link. |
| `otp.hbs` | One-time code, for all OTP types (branch on `otpType`). |
| `change-email-confirmation.hbs` | Approval link sent to the current address. |
| `change-email-verification.hbs` | Confirmation link sent to the new address. |
| `config.json` | Sender display name (`fromName`) and the subject line per email (`subjects`), merged per key with the defaults. |

Each email file wraps the layout and fills its blocks:

```handlebars
{{#> layout}}
	{{#*inline "body"}}<p>Hello {{name}},</p>{{/inline}}
	{{#*inline "footer"}}Ignore this email if it wasn't you.{{/inline}}
{{/layout}}
```

Available variables: `subject`, `expiresIn` (human readable), `name`, `url` (the action link), `email`, `newEmail`, `otp` and `otpType` (`sign-in`, `email-verification`, `forget-password` or `change-email`).
Which of them are set depends on the email. The `eq` helper compares values, e.g. `{{#if (eq otpType "sign-in")}}`.
`{{value}}` is HTML-escaped; avoid `{{{value}}}` for anything user-supplied.

Templates are compiled and checked at startup (syntax, required variables such as the action link or the OTP code, no unescaped `{{{ }}}` output), so a broken design stops the boot with a clear message instead of failing on a user's request. The full contract is in `templates/email/README.md`.
To try a design locally, point `EMAIL_TEMPLATES_DIR` at its folder, for example `EMAIL_TEMPLATES_DIR=./my-templates`.
Changes need a restart.

### Security & operations

- Fail-fast env validation prevents accidental misconfiguration.
- Sentry captures structured errors with tags for faster triage.
- Sign up fraud screening runs only when `FRAUD_CHECK_API_URL` is set (the [DeGhost fraud detection API](https://deghost.hexbyte.dev), endpoint <https://deghostapi.hexbyte.dev>). It is **fail-closed on the email**: the remote must explicitly allow the email (HTTP 200) or the signup is blocked, including when the API is unreachable or returns an error. The client IP is a secondary signal (proxy/VPN and threat checks) that blocks only on an explicit threat verdict.
- Fraud screening covers the self-serve account-creation paths, email/password signup (`/sign-up/email`) and email OTP sign-in (`/sign-in/email-otp`, which creates an account when the user does not yet exist). Social (Google/GitHub) signup is intentionally unscreened because the OAuth provider is responsible for handling fraudulent/abusive accounts.
- Email OTP is opt-in (`EMAIL_OTP_ENABLED=true`) with configurable expiry (`OTP_EXPIRATION_SECONDS`) and hashed OTP storage. Signing in with an OTP creates the account if it does not already exist, so it is fraud-screened just like email/password signup.
- Public-domain policy (`BLOCK_PUBLIC_DOMAIN_SIGNUP=true`, requires `FRAUD_CHECK_API_URL`): reject email/OTP sign-ups whose address is a public/free provider, using the fraud API's `public_domain` verdict. The email must first pass the fraud gate (HTTP 200); the domain policy is then applied on top. OAuth (Google/GitHub) sign-ups are not affected. Default is off (public domains allowed).

  The sign-up hook rejects a request with one of these codes (Better-Auth returns them as JSON `{ code, message }`). These are **not** in the auto-generated Better-Auth schema shown at `/api/docs`, which only reflects Better-Auth's own endpoint schema, not custom hook logic:

  | HTTP | `code` | Trigger |
  | :--- | :--- | :--- |
  | 400 | `EMAIL_NOT_ALLOWED` | Fraud API did not allow the email (any non-200 → fail-closed). |
  | 400 | `PUBLIC_DOMAIN_NOT_ALLOWED` | `BLOCK_PUBLIC_DOMAIN_SIGNUP=true` and the email is a public/free-provider domain. |
  | 403 | `IP_NOT_ALLOWED` | Client IP returned an explicit threat verdict. |
  | 503 | `FRAUD_CHECK_UNAVAILABLE` | Fraud API unreachable or errored (fail-closed). |

- Basic Auth middleware protects internal endpoints and uses timing-safe comparisons.
- `/api/users/*` routes are mounted only when both `API_AUTH_USER` and `API_AUTH_PASSWORD` are configured. When enabled, the internal API is added as a second source in the unified `/api/docs` Scalar reference, generated from the same Zod schemas that validate the requests (so the docs cannot drift from the actual contract).

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
