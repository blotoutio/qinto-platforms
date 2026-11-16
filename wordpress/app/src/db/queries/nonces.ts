import { lt } from 'drizzle-orm'

import type { Db } from '../client'
import { usedNonces } from '../schema'

/** False when the nonce was already used. One atomic insert, so two concurrent replays cannot both pass. */
export const consumeNonce = async (db: Db, input: { registrationId: string; nonce: string; expiresAt: Date }): Promise<boolean> => {
  const inserted = await db.insert(usedNonces).values(input).onConflictDoNothing().returning({ nonce: usedNonces.nonce })

  return inserted.length === 1
}

/** Returns the query unrun, so the hourly sweep can batch it. */
export const sweepNonces = (db: Db, now: number) => db.delete(usedNonces).where(lt(usedNonces.expiresAt, new Date(now)))
