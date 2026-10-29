/**
 * Fails when `schema.ts` and the committed migrations disagree.
 *
 * `drizzle-kit check` only looks for collisions in the journal; it says nothing about drift. So this
 * runs a real `generate` and fails if it produced anything. Without it, a schema edit can ship with
 * no migration, and the mismatch only surfaces when a query hits a column the database lacks.
 *
 * The migrations directory is copied aside first and restored afterwards, so the check leaves the
 * working tree byte-identical whether it passes or fails — `generate` also rewrites the journal and
 * drops a snapshot, which a file-by-file undo would miss.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const migrations = new URL('../drizzle/migrations', import.meta.url).pathname

const sqlFiles = () =>
  readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()

const backup = join(mkdtempSync(join(tmpdir(), 'blotout-db-check-')), 'migrations')
cpSync(migrations, backup, { recursive: true })

const before = sqlFiles()
let added = []
try {
  execFileSync('drizzle-kit', ['generate'], { stdio: 'inherit' })
  added = sqlFiles().filter((name) => !before.includes(name))
} finally {
  rmSync(migrations, { recursive: true, force: true })
  cpSync(backup, migrations, { recursive: true })
  rmSync(backup, { recursive: true, force: true })
}

if (added.length === 0) {
  console.info('db:check — schema and migrations agree')
  process.exit(0)
}

console.error(`db:check — schema.ts has changes with no migration: ${added.join(', ')}`)
console.error('Run `pnpm db:generate`, read the SQL it produces, and commit it.')
process.exit(1)
