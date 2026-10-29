import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// `shopline app dev` starts the Worker on BACKEND_PORT and this dev server on FRONTEND_PORT, then
// tunnels the latter. Every API path has to reach the Worker, including the two OAuth callbacks,
// which arrive top-level rather than through the SPA.
const backend = {
  target: `http://127.0.0.1:${process.env['BACKEND_PORT'] ?? 3457}`,
  changeOrigin: false,
  ws: false
}

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
  server: {
    host: 'localhost',
    port: Number(process.env['FRONTEND_PORT'] ?? 3456),
    proxy: {
      '^/api(/|(\\?.*)?$)': backend
    },
    // The tunnel hostname changes each `shopline app dev`, so it cannot be listed.
    allowedHosts: true
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**', 'src/lib/types.ts', 'src/**/*.test.{ts,tsx}'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 }
    }
  }
})
