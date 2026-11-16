import { and, asc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm'

import type { AppConfig } from '../config'
import type { Db } from '../db/client'
import { sweepNonces } from '../db/queries/nonces'
import { sweepOauthStates } from '../db/queries/oauth-states'
import { sweepUnverified } from '../db/queries/registrations'
import { qintoConnections, registrations } from '../db/schema'
import { forgetInstall, loadAccessToken, QintoGrantRevokedError } from './connection-store'

/** Qinto expires a grant 30 days after its last rotation; rotating after 7 idle days leaves 3 weeks of margin. */
export const KEEP_ALIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** Keeps one run inside the Worker's subrequest limit. */
const KEEP_ALIVE_BATCH = 25

/** The plugin checks in daily; an install silent this long is gone, so its grant is revoked. */
export const SILENT_AFTER_MS = 60 * 24 * 60 * 60 * 1000

/** Up to two revocations each, so this plus the keep-alive batch stays inside the subrequest limit. */
const REAP_BATCH = 10

/** The install's last signed call, or its registration time if it never made one. */
const lastSeen = sql`coalesce(${registrations.lastSeenAt}, ${registrations.createdAt})`

const idleGrantIds = async (db: Db, now: number): Promise<string[]> => {
  const rows = await db
    .select({ id: qintoConnections.registrationId })
    .from(qintoConnections)
    .innerJoin(registrations, eq(registrations.id, qintoConnections.registrationId))
    .where(
      and(
        isNull(qintoConnections.revokedAt),
        isNotNull(qintoConnections.refreshTokenEnc),
        // Only a rotation mints an access token, so its expiry dates the last rotation.
        lte(qintoConnections.accessTokenExpiresAt, new Date(now - KEEP_ALIVE_AFTER_MS)),
        sql`${lastSeen} >= ${now - SILENT_AFTER_MS}`
      )
    )
    .orderBy(asc(qintoConnections.accessTokenExpiresAt))
    .limit(KEEP_ALIVE_BATCH)

  return rows.map((row) => row.id)
}

/** One at a time on purpose: `loadAccessToken` is the only refresh path and owns its race handling. */
export const keepGrantsAlive = async (db: Db, config: AppConfig, now = Date.now()) => {
  const result = { refreshed: 0, revoked: 0, skipped: 0 }

  for (const id of await idleGrantIds(db, now)) {
    try {
      await loadAccessToken(db, config, id)
      result.refreshed += 1
    } catch (error) {
      // One bad row never stops the rest; a busy or unreachable grant is retried next hour.
      const context = { registrationId: id, cause: String(error) }
      if (error instanceof QintoGrantRevokedError) {
        console.warn('keep-alive found a dead Qinto grant', context)
        result.revoked += 1
      } else {
        console.warn('keep-alive skipped a grant', context)
        result.skipped += 1
      }
    }
  }

  return result
}

/** Revokes the grant of every install silent past `SILENT_AFTER_MS`, then deletes the install. */
export const reapSilent = async (db: Db, config: AppConfig, now = Date.now()): Promise<number> => {
  const rows = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(sql`${lastSeen} < ${now - SILENT_AFTER_MS}`)
    .limit(REAP_BATCH)

  for (const { id } of rows) {
    await forgetInstall(db, config, id)
  }

  return rows.length
}

export const sweepExpired = async (db: Db, now = Date.now()): Promise<void> => {
  await db.batch([sweepNonces(db, now), sweepOauthStates(db, now), sweepUnverified(db, now)])
}
