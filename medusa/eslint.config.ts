import { defineConfig } from "eslint/config"
import medusa from "@medusajs/eslint-plugin"

export default defineConfig([
  ...medusa.configs.recommended,
  {
    // `storefront/` ships into a Next.js app, which has no `@medusajs/framework` to import types
    // from. `@medusajs/types` is the right package there, so the backend rule is turned off.
    files: ["storefront/**/*.{ts,tsx}"],
    rules: { "@medusajs/import-from-framework-not-internal": "off" },
  },
])
