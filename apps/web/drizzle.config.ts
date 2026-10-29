import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env files; load the local one when present (absent in CI and on Vercel).
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: rely on the process environment
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn(
    "DATABASE_URL is not set: `db:generate` works, `db:migrate` and `db:studio` will not.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: url ?? "" },
  strict: true,
  verbose: true,
});
