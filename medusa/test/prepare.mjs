import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Makes the compiled sources runnable by `node --test`.
 *
 * The storefront sources import each other extensionlessly (`./mapping`), because that is what
 * Next resolves — Turbopack does **not** apply TypeScript's `.js` → `.ts` remap, so writing
 * `./mapping.js` in the source builds fine under `tsc` and then fails the storefront with
 * `Module not found`. Node's ESM loader has the opposite requirement and rejects the extensionless
 * form. Rather than compromise the source, the extension is added here, to the build output only.
 */
const DIR = ".test-build"

writeFileSync(join(DIR, "package.json"), JSON.stringify({ type: "module" }))

for (const name of readdirSync(DIR).filter((f) => f.endsWith(".js"))) {
  const path = join(DIR, name)
  const patched = readFileSync(path, "utf8").replace(
    /(from\s*)(["'])(\.[^"']*?)\2/g,
    (match, from, quote, specifier) =>
      specifier.endsWith(".js") ? match : `${from}${quote}${specifier}.js${quote}`
  )

  writeFileSync(path, patched)
}
