import { defineConfig } from 'vitest/config'

/**
 * Plain Node, deliberately.
 *
 * The sandbox is neither Node nor a browser, so no environment vitest offers is the real thing.
 * What matters is that the code never reaches for a DOM — and the tsconfig's `WebWorker` lib is
 * what enforces that, at compile time, where it cannot be forgotten.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The entry point is the sandbox handshake; there is no sandbox to hand it here.
      exclude: ['src/index.ts', 'src/types.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 }
    }
  }
})
