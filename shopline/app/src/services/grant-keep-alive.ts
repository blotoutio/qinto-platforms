import { and, asc, isNotNull, isNull, lte } from 'drizzle-orm'

import { BlotoutGrantRevokedError, loadConnection } from '../blotout/connection-store'
import type { AppConfig } from '../config'
import type { Db } from '../db/client'
import { blotoutConnections } from '../db/schema'

/**
 * How long a grant may sit unrefreshed before the sweep rotates it.
 *
 * Qinto expires a grant 30 days after its last rotation (`REFRESH_TOKEN_TTL_MS` in the portal's
 * `oauth/exchange.ts`), and the Worker otherwise rotates only when a merchant opens the app. Seven
 * days leaves three weeks of margin for the cron to be down before an idle store loses its grant.
 */
export const KEEP_ALIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** Keeps one run inside the Worker's subrequest limit: a refresh is one call, a stand-down a few more. */
export const KEEP_ALIVE_BATCH = 25

export type KeepAliveResult = { refreshed: number; revoked: number }

const staleHandles = async (db: Db, now: number): Promise<string[]> => {
  const rows = await db
    .select({ handle: blotoutConnections.handle })
    .from(blotoutConnections)
    .where(
      and(
        isNull(blotoutConnections.revokedAt),
        isNotNull(blotoutConnections.refreshTokenEnc),
        // An access token is minted only by a rotation, so its expiry dates the last one.
        lte(blotoutConnections.accessTokenExpiresAt, new Date(now - KEEP_ALIVE_AFTER_MS))
      )
    )
    .orderBy(asc(blotoutConnections.accessTokenExpiresAt))
    .limit(KEEP_ALIVE_BATCH)

  return rows.map((row) => row.handle)
}

/**
 * Rotates the Blotout grant of every store nobody has opened the app in for a while, so an idle
 * store does not lose it to Qinto's expiry.
 *
 * Sequential on purpose: `loadConnection` is the only refresh path, and running it per store keeps
 * its race handling and its revoke-on-failure rule in one place.
 */
export const keepGrantsAlive = async (db: Db, config: AppConfig, now: number = Date.now()): Promise<KeepAliveResult> => {
  let refreshed = 0
  let revoked = 0

  for (const handle of await staleHandles(db, now)) {
    try {
      await loadConnection(db, config, handle)
      refreshed += 1
    } catch (error) {
      // `loadConnection` turns every refresh failure into a revocation, so only a D1 failure reaches
      // here — and that would fail every store in the batch alike.
      /* istanbul ignore if -- @preserve: unreachable; see above */
      if (!(error instanceof BlotoutGrantRevokedError)) {
        throw error
      }

      // Only logged. The store keeps tracking with its saved config until the merchant reconnects.
      console.warn('keep-alive found a dead Blotout grant', { handle, cause: error.message })
      revoked += 1
    }
  }

  return { refreshed, revoked }
}
