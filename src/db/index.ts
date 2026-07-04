import * as Sentry from "@sentry/bun";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requireEnv } from "../lib/env";
import * as schema from "./schema";

const DATABASE_URL = requireEnv("DATABASE_URL");

const pool = new Pool({ connectionString: DATABASE_URL });

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
