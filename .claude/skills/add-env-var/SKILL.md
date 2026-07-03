---
name: add-env-var
description: Use when adding, introducing, or wiring a new environment variable or config value into this Better-Auth/Hono server. Covers choosing requireEnv vs envWithDefault vs optionalEnv, documenting it in .env.sample, reading it at module scope, and the checkEnv() fail-fast gate.
---

# Add an environment variable

Env vars in this repo are read at **module scope** and validated at boot. Follow all three
places below or the fail-fast gate (`checkEnv()` in `src/index.ts`) will not protect the new var.

## 1. Pick the right helper (`src/lib/env.ts`)

- `requireEnv("NAME")` — app must not start without it (auth secrets, `DATABASE_URL`, `RESEND_API_KEY`,
  email/company identity). Missing `requireEnv` vars are accumulated into one set and reported together
  by `checkEnv()`; no extra wiring needed.
- `envWithDefault("NAME", "default")` — safe fallback for local dev, but production should set it
  (e.g. `JWT_EXPIRATION_TIME`, `TOKEN_EXPIRATION_SECONDS`, `PRIMARY_COLOR`). Logs a notice when the
  default is used.
- `optionalEnv("NAME")` — truly optional, returns `undefined` when unset. Note: for feature flags the
  codebase often reads `process.env.NAME?.trim()` directly instead (see `FRAUD_CHECK_API_URL`,
  `isGoogleEnabled`, `EMAIL_OTP_ENABLED`); match the pattern already used in the file you edit.

Decision rule: `requireEnv` if the app cannot function without it; `envWithDefault` if dev works with a
reasonable fallback but prod should be explicit; `optionalEnv` (or direct `process.env` read) if it
enables/disables a non-critical feature.

## 2. Read it at module scope in the consuming file

Call the helper (or `process.env.NAME?.trim()`) at the **top level** of the module that needs it
(`src/auth.ts`, `src/lib/email.ts`, `src/config/app.config.ts`, `src/db/index.ts`, …).
**Never** call these inside a request handler — that defeats `checkEnv()`, which runs once before the
server starts and can only see module-scope reads.

## 3. Document it in `.env.sample`

Add the variable under the appropriate section header, with a comment block explaining purpose,
format, default, and whether it is required/optional. Match the existing comment style.
Do **not** touch `.env.local` / `.env.zyntime` or other ignored `.env*` files unless the user
explicitly asks.

## Verify

- Confirm `checkEnv()` still reports missing required vars (temporarily unset it in a scratch run if
  unsure), and that `src/index.smoke.test.ts`'s `smokeTestEnv` map is updated if the new var is
  required (otherwise the smoke test will fail `checkEnv()`).
