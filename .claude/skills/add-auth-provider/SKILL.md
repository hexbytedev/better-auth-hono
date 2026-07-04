---
name: add-auth-provider
description: Use when extending Better-Auth in src/auth.ts — enabling a social provider (Google/GitHub), adding or configuring a plugin, or wiring a transactional email flow. Covers the env-presence feature-flag pattern, conditional config spreads, and Resend email templates.
---

# Extend the Better-Auth config

All auth customization is centralized in the single `betterAuth({...})` object in `src/auth.ts`. Keep
Better-Auth itself unmodified — add behavior around it.

## Feature-flag pattern (env presence)

The active auth surface depends on configured env. Gate new capabilities the same way:

- Compute a boolean from env at module scope, e.g.
  `const isXEnabled = Boolean(process.env.X_CLIENT_ID?.trim() && process.env.X_CLIENT_SECRET?.trim());`
- Conditionally spread into the config: `...(isXEnabled && { x: { ... } })` for objects, or a ternary
  returning `[]` for array entries like `plugins` (see the `emailOTP` block).
- Add the backing env vars via the `add-env-var` skill and document them in `.env.sample`.

## Social provider

Add under `socialProviders` using the conditional-spread pattern, mirroring `google`/`github`. Set
`redirectURI` to `${SERVER_URL}/api/auth/callback/<provider>` (a template literal, as in the
`google`/`github` entries). If OAuth needs extra origins (e.g. an Expo scheme), extend `trustedOrigins`.

## Plugin

Add to the `plugins: [...]` array. If the plugin persists data, remap its table with a
`schema: { <model>: { modelName: "..." } }` option and register the table per the `db-migration` skill.
The `jwt` plugin's `definePayload` is where DB-derived claims for downstream services are added.

## Transactional email flow

Any auth action that emails the user (verification, reset, OTP, change-email) wires a `send...` callback
that delegates to `src/lib/email.ts`:

- Add the template function in `src/lib/email.ts`. **HTML-escape every user-supplied value** with
  `escapeHtml` / `escapeHtmlAttribute` before templating, and reuse `getEmailTemplate(...)`.
- In the callback, wrap the send in `try/catch`, `Sentry.captureException(error, { tags: { feature: "auth", operation: "..." }, ... })`, and **re-throw** so Better-Auth knows the send failed (except fire-and-forget flows like `emailOTP`, which catch-and-report without throwing).
- The `Resend` client is created lazily via `getResend()` — do not construct it at module load.

## Verify

Update `smokeTestEnv` / `clearedEnvKeys` in `src/index.smoke.test.ts` so the module still passes
`checkEnv()`, then run `bun run test` and `bun run lint`.
