import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

/**
 * The suite runs inside workerd, not Node, so WebCrypto, D1 and the bindings behave exactly as
 * they do in the deployed Worker.
 */
const migrations = await readD1Migrations('./drizzle/migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          QINTO_API_ORIGIN: 'https://api.qinto.tech',
          QINTO_AUTHORIZE_ORIGIN: 'https://portal.qinto.tech',
          QINTO_CLIENT_ID: 'qc_test',
          QINTO_CLIENT_SECRET: 'qcs_test',
          // 32 bytes, base64. A test key, and the only place one is ever written down.
          TOKEN_KEK: 'dGVzdC1rZWstMzItYnl0ZXMtZXhhY3RseS0hIS0xMjM=',
          DEBUG_ERRORS: 'true',
          // The committed SQL, so a schema edit without a migration fails the tests.
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
      // Declarations only.
      exclude: ['src/env.d.ts', 'src/db/schema.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 }
    }
  }
})
