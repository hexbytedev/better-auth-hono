# Better-Auth Hono: production-ready auth server

> [!TIP]
> **Live demo, nothing to deploy.** Try the full login flow at **[authtry.hexbyte.dev](https://authtry.hexbyte.dev)**.

A ready-to-deploy Docker image of Better-Auth, wrapped in Hono. It includes passkeys, TOTP, JWTs, Google and GitHub sign-in, email and password, email OTP, and an internal user lookup API.

## Why this project

- Ready-to-run Docker image, configured with one `.env.local` file.
- Checks the env at startup, reports errors to Sentry, and ships safe CORS and cookie defaults plus a Postgres schema with tuned indexes.
- Better-Auth itself is not modified. All custom code lives around it, so upgrades stay easy.

## What you get

- One Docker image for the server and the schema setup (`Dockerfile`, `docker-compose.yml`).
- Drizzle schema with UUID primary keys and indexes for fast lookups (`src/db/schema.ts`).
- JWTs for your microservices (`src/auth.ts`).
- An internal user lookup API behind Basic Auth: `GET /api/users/id/:id` and `POST /api/users/email`.
- Email OTP: sign in, verify an email, or reset a password with a one-time code.
- Sign-up fraud protection (optional, set `FRAUD_CHECK_API_URL`):
  - The [DeGhost fraud detection API](https://deghost.hexbyte.dev) (endpoint <https://deghostapi.hexbyte.dev>) must allow the email, or the sign-up is blocked.
  - The client IP is checked for disposable or abusive sources.
  - With `BLOCK_PUBLIC_DOMAIN_SIGNUP=true`, sign-ups from free providers such as gmail.com are rejected. Useful for B2B apps.

## Features at a glance

| Feature | Description | Included |
| :--- | :--- | :---: |
| **Passkeys** | WebAuthn and biometric sign-in | ✅ |
| **Two-Factor (2FA)** | TOTP codes from an authenticator app | ✅ |
| **Social OAuth** | Sign in with Google or GitHub | ✅ |
| **Email & Password** | Classic login with email verification and password reset | ✅ |
| **Email OTP** | Sign-in, verification and password reset with one-time codes | ✅ |
| **JWT Support** | Stateless tokens for microservices | ✅ |
| **Internal User API** | **Custom** lookup by ID or email, behind Basic Auth | ✅ |
| **Signup Protection** | **Custom** fraud checks on email, IP and public domains | ✅ |
| **OpenAPI/Swagger** | Generated API reference | ✅ |
| **Docker Support** | Production-ready container image | ✅ |
| **Database ORM** | Drizzle with UUID v7 and tuned indexes | ✅ |
| **Sentry Monitoring** | Error tracking and performance metrics | ✅ |
| **Code Quality** | Biome linting and formatting, Husky git hooks | ✅ |

## Better Auth plugins in use

| Plugin | Import | Enabled |
| :--- | :--- | :---: |
| **Expo** | `@better-auth/expo` | Always |
| **Email OTP** | `better-auth/plugins` | `EMAIL_OTP_ENABLED` |
| **OpenAPI** | `better-auth/plugins` | Always |
| **Passkey** | `@better-auth/passkey` | Always |
| **Two-Factor (2FA)** | `better-auth/plugins` | Always |
| **JWT** | `better-auth/plugins` | Always |

## Deploy with Docker

One image, `ghcr.io/hexbytedev/better-auth-hono:<version>`, runs the server and sets up the database. The container command picks the mode:

- No command (or `app`): start the auth server.
- `push`: sync `src/db/schema.ts` to the database, then exit. Run it on every deploy or upgrade.

To run the schema setup on its own:

```bash
docker run --rm --env-file .env.local ghcr.io/hexbytedev/better-auth-hono:<version> push
```

On an empty database, `push` creates the whole schema and exits. If a change could affect existing data, `push` asks for confirmation, which needs an interactive terminal. In that case, run it inside the running container:

```bash
# Open a shell in the app container (named better-auth-hono in docker-compose.yml)
sudo docker exec -it better-auth-hono /bin/sh

# Inside the container, run push and answer its prompts
bun run push
```

The container already has `DATABASE_URL`, `drizzle-kit` and the schema, so nothing else is needed.

### 1. Prepare the services

- A **PostgreSQL** database. Its connection string is `DATABASE_URL`.
- A **Resend** account with a verified sender domain, for sending email.

### 2. Configure the environment

Copy `.env.sample` to `.env.local` and fill it in. Each variable is explained in `.env.sample`.
At startup, the server lists every missing required variable and refuses to start.

Required in every deployment:

| Variable | Purpose |
| :--- | :--- |
| `BETTER_AUTH_SERVER_URL` | Public URL of this auth server. Used for OAuth callbacks and as the JWT issuer. |
| `BETTER_AUTH_SECRET` | Secret for signing and encryption. Generate it with `openssl rand -base64 32`. |
| `BETTER_AUTH_RP_ID` | Passkey domain, without `https://` (e.g. `client-frontend.example.com`, or `localhost` in dev). |
| `BETTER_AUTH_RP_NAME` | App name shown in passkey prompts. |
| `CLIENT_URL` | Frontend URL. Allowed by CORS and used as the JWT audience. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `RESEND_API_KEY` | Resend API key. |
| `EMAIL_FROM` | Verified sender address, e.g. `no-reply@example.com`. The display name comes from `fromName` in the templates' `config.json`. |

Everything else (social sign-in, email OTP, fraud checks, Sentry, cookie and CORS settings) is optional. Each feature turns on only when its env vars are set.

### 3. Set up the schema and start

With the provided `docker-compose.yml`, a `push` service sets up the schema first, and the app starts only after it succeeds. Set the image tags to the version you want, then run:

```bash
docker compose up
```

- `GET /api/health` returns `{ "status": "ok", ... }` for health checks.
- `/api/docs` is the API reference (Scalar). It lists every Better-Auth endpoint, plus the internal user API when it is enabled.

### 4. (Optional) Use your own email templates

The image ships English templates in `/app/templates/email`. To use your own design, mount a folder. You edit the files on the server and restart, with no image rebuild.

1. Create the folder next to `docker-compose.yml`. To start from the built-in templates, copy them out of the image once:

   ```bash
   docker create --name tpl-seed ghcr.io/hexbytedev/better-auth-hono:<version>
   docker cp tpl-seed:/app/templates/email ./email-templates
   docker rm tpl-seed
   ```

   Or unzip a design you were given into `./email-templates`. Editing rules: `templates/email/README.md`. Any file missing from the folder uses the built-in version.

2. Mount the folder on the `better-auth-hono` service in `docker-compose.yml` (the lines are already there, commented out):

   ```yaml
   volumes:
     - ./email-templates:/app/email-templates:ro
   ```

3. Set the path inside the container in `.env.local`:

   ```bash
   EMAIL_TEMPLATES_DIR=/app/email-templates
   ```

4. Let the container user (non-root `bun`) read the folder: `chmod -R a+rX ./email-templates`.
5. Start: `docker compose up -d --force-recreate better-auth-hono`.

**Edit a template later.** Change the files in `./email-templates`, then run `docker compose restart better-auth-hono`. Templates load only at startup, so always restart. If an edit breaks a template, the container won't start and keeps retrying (`restart: unless-stopped`). Run `docker logs better-auth-hono` to see why, fix the file, and restart.

**Change the path.** `EMAIL_TEMPLATES_DIR` is a path inside the container, not on your server. In `host-path:container-path`:

- The left part is where the folder lives on your server, e.g. `/srv/mysite/email-templates`.
- The right part must equal `EMAIL_TEMPLATES_DIR`, as an absolute path.

**Check that it worked.** The startup log says which templates loaded:

```text
[EMAIL] Using templates from /app/email-templates, overriding: layout.hbs, verification.hbs, config.json
```

- `[EMAIL] Using the built-in email templates`: `EMAIL_TEMPLATES_DIR` is not set.
- `[EMAIL] EMAIL_TEMPLATES_DIR (...) contains no template files`: the folder is empty, or the mount path doesn't match `EMAIL_TEMPLATES_DIR`.
- `[EMAIL] EMAIL_TEMPLATES_DIR (...) is not a directory`: the path doesn't exist (in the container, or on your machine when running locally). The server starts with the built-in templates.
- `[EMAIL] EMAIL_TEMPLATES_DIR (...) is not readable by the server`: the container's non-root user can't open the folder. Run `chmod -R a+rX` on it. The server starts with the built-in templates.
- `... is not readable by the server` naming a single file: the folder is readable but that file isn't. The server stops. Run `chmod -R a+rX` on the folder.
- An error naming a file and a `{{variable}}`: a template breaks the rules. The server stops. See `templates/email/README.md`.

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

### Database

All scripts run with **Bun**.

- `bun run push`: sync `src/db/schema.ts` to the database. Use it to set up a fresh database and to apply every schema change. It asks before risky changes, so it needs a terminal (TTY).
- `bun run generate`: optional. Saves the change as versioned SQL in `drizzle/` for review and history.
- Drizzle commands read `DATABASE_URL` from `.env.local` (see `drizzle.config.ts`).

Typical schema change: edit `src/db/schema.ts`, run `bun run generate`, then `bun run push` and answer any prompts.

### Code quality

A Husky pre-commit hook runs `bun run lint`.

Manual commands:

- `bun run lint`: lint and auto-fix
- `bun run lint:check`: lint without changing files
- `bun run format`: format code

Pull requests also run:

- `bun run lint:check`
- `bun run build`
- `bun run test`
- `bun audit --audit-level=high`

### Key files

- `src/index.ts`: app startup, CORS, mounts Better-Auth and the internal routes.
- `src/auth.ts`: Better-Auth config (plugins, hooks, database adapter, email callbacks).
- `src/lib/email.ts`: sends email through Resend (verification, password reset, OTP, email change).
- `src/lib/email-templates.ts`: loads and checks the Handlebars templates. The defaults live in `templates/email/`.
- `src/db/schema.ts`: Drizzle schema and indexes.
- `src/routes/users.route.ts`: internal user lookup behind Basic Auth. Built with `@hono/zod-openapi`, so its docs come from the code (`/api/users/openapi.json`, also shown in `/api/docs`).

### Customizing email templates

Emails are [Handlebars](https://handlebarsjs.com) files in `templates/email/`. Each deployment can brand them without code changes.

- Point `EMAIL_TEMPLATES_DIR` at your own folder (for Docker, see step 4 above).
- Brand name, colors and copy go in the templates, not in env vars.
- A file missing from your folder uses the built-in one. Overriding only `layout.hbs` is enough to rebrand every email.

| File | Purpose |
| :--- | :--- |
| `layout.hbs` | Shared HTML shell (branding, header, footer). Renders each email's `body` and `footer` blocks. |
| `verification.hbs` | Sign-up email verification. |
| `password-reset.hbs` | Password reset link. |
| `otp.hbs` | One-time code for every OTP type (branch on `otpType`). |
| `change-email-confirmation.hbs` | Approval link sent to the current address. |
| `change-email-verification.hbs` | Confirmation link sent to the new address. |
| `config.json` | Sender name (`fromName`) and one subject per email (`subjects`). Merged key by key with the defaults. |

Each email file wraps the layout and fills two blocks:

```handlebars
{{#> layout}}
  {{#*inline "body"}}<p>Hello {{name}},</p>{{/inline}}
  {{#*inline "footer"}}Ignore this email if it wasn't you.{{/inline}}
{{/layout}}
```

- Variables: `subject`, `name`, `url` (the action link), `expiresIn` (e.g. `1 hour`), `expiresInDe` (the same in German), `email`, `newEmail`, `otp` and `otpType`. Which ones are set depends on the email.
- Compare values with the `eq` helper: `{{#if (eq otpType "sign-in")}}`.
- `{{value}}` escapes HTML. Never use `{{{value}}}`: the server rejects it.

The server checks every template at startup: syntax, required variables (such as the action link or the OTP code), and no `{{{ }}}`. A broken design stops the server with a clear error, instead of failing when a user needs the email. Full rules: `templates/email/README.md`.

To try a design locally, set `EMAIL_TEMPLATES_DIR=./my-templates`. Restart after every change.

### Security & operations

- The server checks env vars at startup and refuses to run with a bad config.
- Sentry captures errors with tags for faster triage.
- Fraud screening runs only when `FRAUD_CHECK_API_URL` is set ([DeGhost fraud detection API](https://deghost.hexbyte.dev), endpoint <https://deghostapi.hexbyte.dev>).
  - **Email check, fail-closed.** The API must allow the email (HTTP 200). Otherwise the sign-up is blocked, also when the API is down or returns an error.
  - **IP check, secondary.** Proxy, VPN and threat checks. Blocks only on an explicit threat verdict.
  - **Screened paths:** email and password sign-up (`/sign-up/email`) and email OTP sign-in (`/sign-in/email-otp`, which creates the account if it doesn't exist). Google and GitHub sign-ups are not screened, because the OAuth provider handles abuse.
- Email OTP is off by default. Turn it on with `EMAIL_OTP_ENABLED=true`. Codes are stored hashed and expire after `OTP_EXPIRATION_SECONDS`. OTP sign-in creates missing accounts, so it is fraud-screened like a normal sign-up.
- `BLOCK_PUBLIC_DOMAIN_SIGNUP=true` (needs `FRAUD_CHECK_API_URL`) rejects email and OTP sign-ups from free providers, using the fraud API's `public_domain` verdict. It applies after the email passes the fraud check. Google and GitHub sign-ups are not affected. Off by default.

  A blocked sign-up returns JSON `{ code, message }` with one of these codes. They are not in the `/api/docs` schema, which covers only Better-Auth's own endpoints:

  | HTTP | `code` | When |
  | :--- | :--- | :--- |
  | 400 | `EMAIL_NOT_ALLOWED` | The fraud API did not allow the email (any non-200 response). |
  | 400 | `PUBLIC_DOMAIN_NOT_ALLOWED` | `BLOCK_PUBLIC_DOMAIN_SIGNUP=true` and the email uses a free provider. |
  | 403 | `IP_NOT_ALLOWED` | The client IP got an explicit threat verdict. |
  | 503 | `FRAUD_CHECK_UNAVAILABLE` | The fraud API is unreachable or returned an error. |

- Basic Auth protects the internal endpoints and compares credentials in constant time.
- `/api/users/*` is mounted only when both `API_AUTH_USER` and `API_AUTH_PASSWORD` are set. Its `/api/docs` entry is generated from the same Zod schemas that validate requests, so the docs always match the API.

### Running behind nginx / Cloudflare

The reverse proxy is the trust boundary. `getClientIP()` uses the TCP socket address. It trusts `X-Real-IP` / `X-Forwarded-For` only when the connection comes from a `TRUSTED_PROXIES` entry (IP or CIDR, IPv4 or IPv6).

Set `TRUSTED_PROXIES` to the address the proxy connects from. For nginx on the same host, that is usually `127.0.0.1` and/or `::1`.

For **Cloudflare → nginx → app**:

1. nginx reads the real visitor IP from `CF-Connecting-IP`, but trusts that header only from Cloudflare's IP ranges.
2. nginx forwards the IP to the app as `X-Real-IP`.
3. The app trusts nginx through `TRUSTED_PROXIES`.

This way, nginx is the only place that decides the real IP.

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

Then set `TRUSTED_PROXIES=127.0.0.1` (add `::1` if nginx connects to the app over IPv6).
Without Cloudflare, remove the `set_real_ip_from` and `real_ip_header` lines and keep the `server { … }` block. nginx then sets `X-Real-IP` from its own `$remote_addr`.

### Development notes

- Don't change Better-Auth internals. Keep custom code around it to preserve upgradability.

License: [MIT](LICENSE)
