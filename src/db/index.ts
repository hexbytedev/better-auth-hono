import * as Sentry from "@sentry/bun";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { parseNumber } from "../config/app.config";
import { requireEnv } from "../lib/env";
import * as schema from "./schema";

const DATABASE_URL = requireEnv("DATABASE_URL");

// Pool sizing. Default mirrors pg's own (10); exposed via env like the rest of
// the project's tunables.
const DB_POOL_MAX = parseNumber(process.env.DB_POOL_MAX, 10, {
	min: 1,
	name: "DB_POOL_MAX",
});
// Acquisition timeout, set explicitly so a query issued while Postgres is
// unreachable fails fast (default 5s, matching OUTBOUND_REQUEST_TIMEOUT_MS)
// instead of hanging forever on pg's default of "wait indefinitely".
const DB_CONNECTION_TIMEOUT_MS = parseNumber(process.env.DB_CONNECTION_TIMEOUT_MS, 5000, {
	min: 1,
	name: "DB_CONNECTION_TIMEOUT_MS",
});

const pool = new Pool({
	connectionString: DATABASE_URL,
	max: DB_POOL_MAX,
	connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
});

// An idle client can lose its backend connection (Postgres restart, failover,
// proxy connection recycling). Without this listener the pool's 'error' event
// becomes an uncaught exception and crashes the process; the pool otherwise
// recovers by replacing the dead client on the next query.
pool.on("error", (err) => {
	console.error("[db] Unexpected error on idle client:", err);
	Sentry.captureException(err, {
		tags: { feature: "database", operation: "pool-idle-error" },
		level: "warning",
	});
});

export const db = drizzle(pool, { schema });
