import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * A development-only preview of the app's screens.
 *
 * `pnpm preview:screens` serves `preview/`, with App Bridge aliased to a stub, so the real
 * components and the real stylesheet can be looked at without a SHOPLINE Admin. Nothing here is
 * part of the shipped bundle.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./preview', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^\.\.\/lib\/app-bridge$/,
        replacement: fileURLToPath(new URL('./preview/app-bridge-stub.ts', import.meta.url))
      },
      {
        find: /^\.\/app-bridge$/,
        replacement: fileURLToPath(new URL('./preview/app-bridge-stub.ts', import.meta.url))
      },
      {
        // `lib/api.ts` reaches for `shared` and `Redirect` from the package itself, so the package
        // has to be replaced too or every call waits on an Admin that is not there.
        find: '@shoplineos/app-bridge',
        replacement: fileURLToPath(new URL('./preview/shopline-app-bridge-stub.ts', import.meta.url))
      }
    ]
  },
  server: { host: '127.0.0.1', port: 4321 }
})
