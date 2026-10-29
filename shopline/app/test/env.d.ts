import type { D1Migration } from '@cloudflare/vitest-pool-workers'

/**
 * Test-only bindings, supplied by `vitest.config.ts`.
 *
 * Declared here rather than in `src/env.d.ts` so the production `Env` never advertises a binding
 * that only exists under vitest.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[]
    }
  }

  interface Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}
