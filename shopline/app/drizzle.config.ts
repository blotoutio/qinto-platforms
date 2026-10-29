import { defineConfig } from 'drizzle-kit'

/**
 * `d1-http` credentials exist only so `drizzle-kit generate`, `check` and `studio` can introspect
 * the remote database. The Worker never uses them — it talks to D1 through its binding.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '',
    databaseId: process.env['CLOUDFLARE_DATABASE_ID'] ?? '',
    token: process.env['CLOUDFLARE_D1_TOKEN'] ?? ''
  }
})
