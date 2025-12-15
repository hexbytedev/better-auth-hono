import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Add this line to load variables from .env.local
config({ path: ".env.local" });

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
