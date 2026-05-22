# AGENTS.md

## Guidance for agentic coding in this repo

## Project Overview

- Runtime: Bun (server) with Hono, Better-Auth, Drizzle ORM, PostgreSQL.
- Entry: `src/index.ts` (env load, Sentry init, routing, CORS).
- Auth: `src/auth.ts` (Better-Auth config, hooks, plugins).
- DB: `src/db/*` (Drizzle schema and db setup).
- Internal API: `src/routes/users.route.ts` + `src/services/user.service.ts`.
- Email integration: `src/lib/email.ts`.

## Agent Rules (Cursor/Copilot)

- No Cursor rules found in `.cursor/rules/` or `.cursorrules`.
- No Copilot instructions found in `.github/copilot-instructions.md`.

## Required Environment

- Many env vars are required at module import (app fails fast).
- Use `.env.sample` as the authoritative env template; use `README.md` for deployment and workflow notes.
- `drizzle.config.ts` explicitly loads `.env.local`, so Drizzle commands require explicit permission before reading that ignored file.

## Commands (Bun)

Install

- `bun install`

Run (dev)

- `bun run dev` (hot reload)

Build

- `bun run build` (Bun build into `dist/`)
- `bun run start` (runs `dist/index.js`)

Lint/Format

- `bun run lint` (Biome check + write fixes)
- `bun run lint:check` (Biome check only)
- `bun run format` (Biome format + write)

DB (Drizzle)

- `bun run generate` (wrapper for `bunx drizzle-kit generate`)
- `bun run push` (wrapper for `bunx drizzle-kit push`)

Tests

- No `test` script is configured in `package.json`.
- If adding tests, prefer Bun test (`bun test`) and update this file with
  single-test examples (e.g., `bun test path/to/file.test.ts`).

CI

- GitHub Actions runs a lint workflow with `bun run lint` and `bun audit --audit-level=high`.
- A separate workflow builds and pushes Docker images on tag pushes or manual `workflow_dispatch`.

## Code Style Guidelines

### Formatting (Biome)

- Indentation: tabs.
- Line width: 100.
- Quotes: double.
- Semicolons: always.
- Run `bun run lint` before commits.

### TypeScript

- `tsconfig.json` has `strict: true`.
- Keep types explicit where inference is unclear.
- Avoid `any` when practical, but lint allows it (use sparingly).

### Imports

- Use ESM imports.
- Order: external packages first, then internal `./`/`../` imports.
- Avoid circular dependencies.

### Naming Conventions

- Files: kebab or dot-separated (`users.route.ts`, `app.config.ts`).
- Functions/vars: `camelCase`.
- Types/interfaces: `PascalCase`.
- Constants: `UPPER_SNAKE_CASE` for config/env values.
- Routes: keep route instances named with `*Route` suffix.

### Error Handling & Observability

- Fail fast for missing required env vars (throw early at module scope).
- Log errors with `console.error` and capture with Sentry where appropriate.
- Include tags/context in Sentry (`feature`, `operation`, `route`, etc.).
- For user-facing API errors, return structured JSON with `success: false`.

### API Patterns

- Use Zod for request validation (`@hono/zod-validator`).
- Services should shape safe responses (see `UserResponseSchema`).
- Avoid exposing sensitive fields (passwords, secrets, tokens).

### Security

- Internal APIs are protected with Basic Auth middleware.
- Use `timingSafeEqual` in auth middleware (see existing pattern).
- Do not log secrets or full credentials.

### DB/Drizzle

- Schema lives in `src/db/schema.ts`.
- Prefer typed `select` projections and return safe DTOs.
- For migrations, edit schema then run drizzle generate/push.

### Better-Auth

- Keep Better-Auth config centralized in `src/auth.ts`.
- Hooks should be defensive: wrap external API calls with try/catch.
- Use `APIError` for validation/fraud-blocking flows.

### Hono Routing

- Use `Hono` routers per feature and mount in `src/index.ts`.
- Use `app.route("/path", router)`.
- Keep CORS configuration centralized (`src/config/app.config.ts`).

### Comments

- Comments are used to explain non-obvious behavior or flows.
- Prefer self-describing code; only add comments when clarity needs it.

## Markdown Formatting (for README and docs)

- Use ATX headers only (`#`, `##`, `###`). Do not use setext-style underlined headers.
- Insert an extra blank line between a header and the first following paragraph or list.
- Use `-` (dash) for list bullets. Do not use double em-dash characters in place of bullets.
- Prefer ASCII hyphen `-` for an inline dash instead of the unicode em-dash `—` (avoid non-ASCII punctuation unless the file already uses it).
- Keep phrasing concise and avoid repeating the same claim multiple times in the same document.

## When Adding Tests (Recommended Pattern)

- Use file naming like `*.test.ts` in `src/` or `tests/`.
- If using Bun test:
  - All tests: `bun test`
  - Single file: `bun test path/to/file.test.ts`
  - Single test name: `bun test -t "name"`
- Update `package.json` with a `test` script if added.

## Common Files to Check

- `package.json` for scripts and dependencies.
- `biome.json` for lint/format rules.
- `.env.sample` for required environment variables and defaults.
- `drizzle.config.ts` for Drizzle env-loading behavior.
- `README.md` for deployment and workflow details.

## Working Agreements for Agents

- Do not modify `dist/` manually (generated output).
- Avoid editing `.env*` files unless explicitly requested.
- Keep changes focused; follow existing patterns in the file you edit.
- If unsure about behavior, read the relevant source files first.

## Access Controls - Denylist & Allowlist

- Treat the repository `.gitignore` patterns as a strict denylist for agent file access unless a specific file is explicitly allowed.
- By default the agent MUST NOT read, search, list, or modify any path that matches `.gitignore` patterns (examples: `node_modules/`, `dist/`, `.env`, `.env.local`, `.env.zyntime`, `coverage/`, `*.log`).
- Explicit allowlist: the only ignored files currently permitted for read access are `.env.sample` and `.env.example` (these were allowed by the repository owner). Any other ignored file requires explicit per-path permission.
- For glob or recursive operations (e.g., `**/*`, `src/**`): if a glob can match any denylisted path the agent must refuse and request a narrower include pattern or explicit allow for the relevant paths.
- For Bash commands: the agent will refuse to run commands that would read or write denylisted paths (for example `cat .env`, `rm -rf node_modules`, or commands that produce output in `dist/`) unless the user explicitly permits the specific command and the exact paths it will touch.
- Negated `.gitignore` entries (lines starting with `!`) are NOT automatically allowed. Treat them as denied unless the exact file path is added to the allowlist by the user.
- How to request access: provide an explicit, single-path allow request (for example: `allow: path/to/file`) or add the path to the repo owner provided allowlist; the agent will then permit reads on that path only.
- When refusing access, the agent must explain which `.gitignore` pattern blocked the request and how to grant permission safely (exact path or change to `.gitignore`).

These rules are enforced to protect secrets and reduce accidental operations against large or generated directories. Follow them strictly when writing or running automation hooks.
