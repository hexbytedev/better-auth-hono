import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requireEnv } from "../lib/env";
import * as schema from "./schema";

const DATABASE_URL = requireEnv("DATABASE_URL");

const pool = new Pool({ connectionString: DATABASE_URL });
export const db = drizzle(pool, { schema });
