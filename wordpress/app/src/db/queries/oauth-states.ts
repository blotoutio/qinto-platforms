import { eq, lt } from 'drizzle-orm'

import { decryptSecret, encryptSecret, secretAad } from '../../crypto/secret'
import type { Db } from '../client'
import { oauthStates } from '../schema'

/** Long enough for a real consent screen, short enough that a leaked state is useless. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

type OauthState = typeof oauthStates.$inferSelect

type OauthStateInput = { state: string; registrationId: string; codeVerifier: string; wpNonce: string }

const verifierAad = (state: string): string => secretAad('oauth_states', state, 'code_verifier')

export const putOauthState = async (db: Db, kek: string, input: OauthStateInput): Promise<void> => {
  const codeVerifier = await encryptSecret(kek, input.codeVerifier, verifierAad(input.state))
  await db.insert(oauthStates).values({ ...input, codeVerifier, createdAt: new Date() })
}

/** The row with its verifier decrypted, or undefined when expired or it no longer decrypts. */
const openLiveState = async (kek: string, row: OauthState | undefined, now: number): Promise<OauthState | undefined> => {
  if (row === undefined || now - row.createdAt.getTime() > OAUTH_STATE_TTL_MS) {
    return undefined
  }

  const codeVerifier = await decryptSecret(kek, row.codeVerifier, verifierAad(row.state)).catch(() => undefined)
  if (codeVerifier === undefined) {
    return undefined
  }

  return { ...row, codeVerifier }
}

/** Reads and deletes a state whatever the outcome: single use is the CSRF defence. */
export const consumeOauthState = async (db: Db, kek: string, state: string, now = Date.now()) => {
  const [row] = await db.delete(oauthStates).where(eq(oauthStates.state, state)).returning()
  const live = await openLiveState(kek, row, now)
  if (live === undefined) {
    return undefined
  }

  return { registrationId: live.registrationId, codeVerifier: live.codeVerifier, wpNonce: live.wpNonce }
}

/** Reads a live state without consuming it, for the confirmation page. */
export const findOauthState = async (db: Db, kek: string, state: string, now = Date.now()) => {
  const [row] = await db.select().from(oauthStates).where(eq(oauthStates.state, state)).limit(1)

  return openLiveState(kek, row, now)
}

/** Returns the query unrun, so the hourly sweep can batch it. */
export const sweepOauthStates = (db: Db, now = Date.now()) => {
  return db.delete(oauthStates).where(lt(oauthStates.createdAt, new Date(now - OAUTH_STATE_TTL_MS)))
}
