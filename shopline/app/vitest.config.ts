import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

/**
 * The suite runs inside workerd, not Node.
 *
 * WebCrypto, D1 and the `Env` bindings behave differently enough that a Node-hosted test would
 * prove nothing about the Worker — the AES-GCM helper and every Drizzle query run against the real
 * runtime and a real local D1.
 *
 * `@cloudflare/vitest-pool-workers` 0.22 is a Vite plugin; the `defineWorkersConfig` helper and the
 * `/config` entry point it used to live at are gone.
 */
const migrations = await readD1Migrations('./drizzle/migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          SHOPLINE_APP_KEY: 'test-app-key',
          QINTO_API_ORIGIN: 'https://api.qinto.tech',
          QINTO_AUTHORIZE_ORIGIN: 'https://portal.qinto.tech',
          SHOPLINE_APP_SECRET: 'test-app-secret',
          QINTO_CLIENT_ID: 'qc_test',
          QINTO_CLIENT_SECRET: 'qcs_test',
          // 32 bytes, base64. A test key, and the only place one is ever written down.
          TOKEN_KEK: 'dGVzdC1rZWstMzItYnl0ZXMtZXhhY3RseS0hIS0xMjM=',
          // So an unexpected 500 in a test names its cause instead of hiding behind `internal`.
          DEBUG_ERRORS: 'true',
          // The committed SQL, so the tests run against the schema that ships rather than one
          // rebuilt from schema.ts. A missing migration is therefore a test failure.
          TEST_MIGRATIONS: migrations
        }
      }
    })
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      // The Worker entry point is routing plus an error table; the other two are declarations only.
      exclude: ['src/index.ts', 'src/env.d.ts', 'src/db/schema.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 }
    }
  }
})
