/**
 * The window identity is de-duplicated over (`identity.ts`), as far as this store's pixel can tell.
 *
 * This is local bookkeeping and never leaves the browser. The visit the edge counts is the edge's own
 * (`vis_…`, reported in `qinto:connect` and carried by `visitor.ts`); this only decides how long an
 * identify already sent stays sent. It lives in the storefront's sessionStorage, reached through the
 * sandbox's async proxy, so it lasts one tab and 30 idle minutes, like the edge's visit.
 */

export type SessionContext = { id: string; isNew: boolean; startedAt: number }

type StorageProxy = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<unknown>
}

const KEY = 'blotout_shopline_session'
const MAX_AGE_MS = 30 * 60 * 1000

type Stored = { id: string; startedAt: number }

const isStored = (value: unknown): value is Stored => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return typeof candidate['id'] === 'string' && candidate['id'] !== '' && typeof candidate['startedAt'] === 'number'
}

const mint = (now: number): Stored => {
  return { id: `sl_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`, startedAt: now }
}

/**
 * Reads the session, minting one when there is none or it has gone stale.
 *
 * Storage failures fall back to a fresh in-memory session rather than stopping tracking: a visitor
 * with storage blocked should still produce events, just not a stitched session.
 */
export const resolveSession = async (storage: StorageProxy, now = Date.now()): Promise<SessionContext> => {
  const raw = await storage.getItem(KEY).catch(() => null)

  let parsed: unknown
  try {
    parsed = raw === null ? null : JSON.parse(raw)
  } catch {
    parsed = null
  }

  if (isStored(parsed) && now - parsed.startedAt < MAX_AGE_MS) {
    return { id: parsed.id, isNew: false, startedAt: parsed.startedAt }
  }

  const fresh = mint(now)
  await storage.setItem(KEY, JSON.stringify(fresh)).catch(() => undefined)

  return { id: fresh.id, isNew: true, startedAt: fresh.startedAt }
}
