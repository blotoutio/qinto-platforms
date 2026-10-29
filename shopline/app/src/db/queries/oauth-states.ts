import { eq, lt } from 'drizzle-orm'

import type { Db } from '../client'
import { blotoutOauthStates } from '../schema'

/** Long enough for a real consent screen, short enough that a leaked state is useless. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export const putOauthState = async (db: Db, input: { state: string; handle: string; codeVerifier: string }): Promise<void> => {
  await db.insert(blotoutOauthStates).values({ ...input, createdAt: new Date() })
}

export type ConsumedState = { handle: string; codeVerifier: string }

/**
 * Reads a state and deletes it, whatever the outcome.
 *
 * Single-use is the point: it is the CSRF defence and the PKCE verifier's only home, so a replayed
 * callback must find nothing. Deleting before the expiry check means an expired state is also
 * consumed rather than left for a second attempt.
 */
export const consumeOauthState = async (db: Db, state: string, now = Date.now()): Promise<ConsumedState | undefined> => {
  const [row] = await db.select().from(blotoutOauthStates).where(eq(blotoutOauthStates.state, state)).limit(1)
  await db.delete(blotoutOauthStates).where(eq(blotoutOauthStates.state, state))
  if (row === undefined || now - row.createdAt.getTime() > OAUTH_STATE_TTL_MS) {
    return undefined
  }

  return { handle: row.handle, codeVerifier: row.codeVerifier }
}

/** Sweeps abandoned states. Called opportunistically when a new one is minted. */
export const sweepOauthStates = async (db: Db, now = Date.now()): Promise<void> => {
  await db.delete(blotoutOauthStates).where(lt(blotoutOauthStates.createdAt, new Date(now - OAUTH_STATE_TTL_MS)))
}
