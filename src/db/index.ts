import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) throw new Error("DATABASE_URL is missing");

const pool = new Pool({ connectionString: DATABASE_URL });
export const db = drizzle(pool, { schema });
