---
name: db-migration
description: Use when changing the database schema — adding or altering a Drizzle table, column, index, or constraint in src/db/schema.ts — and generating/applying the migration. Covers the UUIDv7/timestamp conventions, Better-Auth drizzleAdapter registration, and the generate/push workflow.
---

# Database schema change + migration

Drizzle ORM over a `pg` Pool. All schema lives in `src/db/schema.ts`; the `db` instance is built in
`src/db/index.ts`.

## 1. Edit `src/db/schema.ts`

Match the existing conventions:

- **Primary key**: `uuid("id").primaryKey().$defaultFn(() => uuidv7())` — IDs come from the schema,
  not Better-Auth (`advanced.database.generateId: false` in `src/auth.ts`).
- **Timestamps**: `timestamp(..., { mode: "date", withTimezone: true })` with `.defaultNow().notNull()`,
  and `.$onUpdate(() => new Date())` for `updated_at`.
- **Constraints/indices**: return an array from the table callback — `unique("name").on(...)` and
  `index("name").on(...)`. Add indices tuned for how the column is looked up.
- **Foreign keys**: `.references(() => users.id, { onDelete: "cascade" })`.
- Add matching `$inferSelect` / `$inferInsert` type exports at the bottom of the file.

## 2. If the table is Better-Auth managed, register it in TWO spots in `src/auth.ts`

Better-Auth core models (`users`, `sessions`, `accounts`, `verifications`, `twoFactors`, `passkeys`,
`jwks`) are wired in two places and BOTH must be kept in sync:

1. The `drizzleAdapter(db, { provider: "pg", schema: { ... } })` map.
2. The model remap — top-level `user`/`session`/`account`/`verification` `modelName` fields, or a
   plugin's `schema: { <model>: { modelName: "..." } }` option (see `passkey`, `twoFactor`, `jwt`).

Custom application tables (e.g. `user_emails`) are **not** registered with Better-Auth — they are used
directly via `schema.userEmails` in app code.

Note: `src/db/relations.ts` defines Drizzle relations but is **not** imported into the `db` instance
(`drizzle(pool, { schema })` only receives `schema.ts`), so `db.query.*.findFirst({ with: ... })`
relational loads are not active. Don't rely on relations unless you also wire them into `src/db/index.ts`.

## 3. Generate and apply

`drizzle.config.ts` loads `.env.local` directly (not `dotenv/config`), so `DATABASE_URL` must be set
in `.env.local` for these commands.

- `bun run generate` — emits SQL into `drizzle/`.
- `bun run push` — applies it to the database.
- `bun run studio` — open Drizzle Studio to inspect.

Review the generated `drizzle/*.sql` before pushing to production. The `better-auth-hono-migrate` Docker
image runs `bunx drizzle-kit push` as its entrypoint.

## Also consider

- New env vars → follow the `add-env-var` skill.
- If the change exposes user data through the internal API, update the `select` projection and safe DTO
  in `src/services/user.service.ts` — never widen it to return raw rows.
