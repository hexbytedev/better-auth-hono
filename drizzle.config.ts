import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Add this line to load variables from .env.local
config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) throw new Error("DATABASE_URL is missing");

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: DATABASE_URL,
  },
});
