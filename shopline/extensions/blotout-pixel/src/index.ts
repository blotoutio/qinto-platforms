import type { ShoplinePixelsApi } from '@shoplineos/shopline-pixels-extension'
import { configure } from '@shoplineos/shopline-pixels-extension'

import { openBlotoutSocket } from './blotout-socket'
import { readConsent } from './consent'
import { identitySender, knownIdentity, readSentIdentity } from './identity'
import { resolveSession } from './session'
import type { Analytics } from './subscriptions'
import { subscribeAll } from './subscriptions'
import type { PixelSettings } from './types'

/**
 * Blotout's SHOPLINE pixel.
 *
 * Runs on every storefront page, in a strict sandbox with no DOM. Auto-activated on app install, so
 * there is no merchant step and no way to switch it off from SHOPLINE's side — which is why the
 * `enabled` setting exists and why it is checked first.
 */
configure(async (api: ShoplinePixelsApi) => {
  const { destination, enabled } = api.settings as PixelSettings

  // The storefront's console is the only place a merchant or we can see any of this. Nothing here
  // may throw: a tracking failure is not the storefront's problem.
  const report = (message: string): void => {
    console.warn(`[blotout] ${message}`)
  }

  // The kill switch, and the first thing that happens. A disabled store opens no socket, subscribes
  // to no event and reads no cookie or storage. Settings arrive as strings, so this is `'true'`,
  // never `true`.
  if (enabled !== 'true' || typeof destination !== 'string' || destination === '') {
    return
  }

  const context = api.init.context
  const referrer = context.document.referrer

  // Both reads in one round trip. Subscribing is already behind an await, and doubling that delay
  // is the one thing worth avoiding here.
  const storage = api.browser.sessionStorage
  const [session, storedIdentity] = await Promise.all([resolveSession(storage), readSentIdentity(storage)])

  const blotout = openBlotoutSocket({
    destination,
    page: {
      url: context.window.location.href,
      ...(referrer === '' ? {} : { referrer })
    },
    session,
    onError: report
  })

  // Subscribe before consent is read. Consent is a pass-through, not a gate — waiting on an async
  // storage read would drop the `page_viewed` that fires while we wait.
  // The cast is upstream's typing, contained here. `subscribe` is declared `<K extends string>`
  // with an unconstrained `Events[K]` fallback, so its callback parameter is contravariantly
  // incompatible with any concretely-typed handler. The payload shapes in `types.ts` are what
  // actually keep the mapping honest.
  const identify = identitySender({
    blotout,
    sessionId: session.id,
    known: knownIdentity(storedIdentity, session.id),
    storage
  })

  subscribeAll(api.analytics as unknown as Analytics, blotout, identify, report)

  const consent = await readConsent(api.browser)
  if (consent !== null) {
    blotout.consent(consent)
  }
})
