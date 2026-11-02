/**
 * The visitor and visit the edge put this browser in, carried from one page to the next.
 *
 * A sandboxed client cannot rely on the edge's cookie reaching its socket, so the documented way to
 * continue a visitor is to keep what the edge reported in its `qinto:connect` event and hand it back
 * on the next connect as `pageContext.visitor` (docs: Headless → Sandboxed pages). The SDK puts it on
 * the `/open` URL as `uid` and `session`.
 *
 * Kept in the storefront's localStorage, because a visitor outlives a tab. The visit does not: the
 * edge ends one after 30 idle minutes but accepts any well-formed session id it is handed, so a stale
 * one is dropped here rather than continuing a visit that is over.
 */

type StorageProxy = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<unknown>
}

export type VisitorContext = { id: string; session?: string }

type VisitSession = { id: string; startedAt: number }

export type StoredVisitor = { anonId: string; session?: VisitSession; seenAt: number }

const KEY = 'blotout_shopline_visitor'
const VISIT_IDLE_MS = 30 * 60 * 1000

const asSession = (value: unknown): VisitSession | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  const id = candidate['id']
  const startedAt = candidate['startedAt']

  return typeof id === 'string' && id !== '' && typeof startedAt === 'number' && Number.isFinite(startedAt) ? { id, startedAt } : undefined
}

/**
 * The visitor in a `qinto:connect` detail or a stored record, or null.
 *
 * Both come from outside this code — one from the edge, one from storage any script on the store can
 * write — so neither is trusted until it has the shape the edge itself would accept.
 */
const asVisitor = (value: unknown, seenAt: number): StoredVisitor | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Record<string, unknown>
  const anonId = candidate['anonId']
  if (typeof anonId !== 'string' || !anonId.startsWith('anon_')) {
    return null
  }

  const session = asSession(candidate['session'])

  return { anonId, ...(session === undefined ? {} : { session }), seenAt }
}

export const readVisitor = async (storage: StorageProxy): Promise<StoredVisitor | null> => {
  const raw = await storage.getItem(KEY).catch(() => null)

  let parsed: unknown
  try {
    parsed = raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }

  const seenAt = (parsed as Record<string, unknown> | null)?.['seenAt']

  return typeof seenAt === 'number' ? asVisitor(parsed, seenAt) : null
}

/** What to hand the SDK's `pageContext.visitor`: the visitor always, the visit only while it is live. */
export const visitorContext = (stored: StoredVisitor | null, now: number): VisitorContext | undefined => {
  if (stored === null) {
    return undefined
  }

  const live = stored.session !== undefined && now - stored.seenAt < VISIT_IDLE_MS

  return live && stored.session !== undefined
    ? { id: stored.anonId, session: `${stored.session.id}.${stored.session.startedAt}` }
    : { id: stored.anonId }
}

/**
 * Records the visitor from a `qinto:connect` detail and returns it, or returns null for a detail
 * without one. The write is fire-and-forget: a storefront that blocks storage still tracks, it just
 * starts a new visitor on its next page.
 */
export const rememberVisitor = (storage: StorageProxy, detail: unknown, now: number): StoredVisitor | null => {
  const visitor = asVisitor(detail, now)
  if (visitor !== null) {
    void storage.setItem(KEY, JSON.stringify(visitor)).catch(() => undefined)
  }

  return visitor
}
