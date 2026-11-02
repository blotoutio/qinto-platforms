/**
 * A stand-in for the sandbox's `WebSocket`, answering the way the Qinto edge does.
 *
 * The SDK runs for real on top of it, so what these tests read is the wire the SDK actually
 * produces. The replies follow the edge's own frames (`projects/worker/src/id-graph/anon/websocket.ts`
 * in the Qinto repo): `connect` once the socket opens, `ack` per action, `consentState` for consent.
 */

export const ANON_ID = 'anon_00000000-0000-4000-8000-000000000000'
export const VISIT = { id: 'vis_00000000-0000-4000-8000-000000000001', isNew: true, startedAt: 1_700_000_000_000 }

const CONSENT = { categories: { necessary: true, functional: false, analytics: false, marketing: false, salesOfData: false }, apps: {} }

export class FakeEdgeSocket {
  static instances: FakeEdgeSocket[] = []
  static failConstruction = false

  static reset(): void {
    FakeEdgeSocket.instances = []
    FakeEdgeSocket.failConstruction = false
  }

  static get last(): FakeEdgeSocket | undefined {
    return FakeEdgeSocket.instances.at(-1)
  }

  readonly url: string
  readonly sent: string[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    if (FakeEdgeSocket.failConstruction) {
      throw new Error('blocked by the sandbox')
    }

    this.url = url
    FakeEdgeSocket.instances.push(this)
  }

  get query(): URLSearchParams {
    return new URL(this.url).searchParams
  }

  /** Completes the handshake: the socket opens and the edge reports the visitor and visit. */
  accept(): void {
    this.readyState = 1
    this.onopen?.()
    this.reply({
      t: 'connect',
      visitor: { anonId: ANON_ID, globalId: null, ip: null, geo: null },
      session: VISIT,
      consent: CONSENT,
      sharedContext: {}
    })
  }

  send(payload: string): void {
    this.sent.push(payload)
    const frame = JSON.parse(payload) as { t: string; ref?: string }
    if (frame.ref === undefined) {
      return
    }

    this.reply(
      frame.t === 'consent'
        ? { t: 'consentState', ref: frame.ref, anonId: ANON_ID, ...CONSENT }
        : { t: 'ack', ref: frame.ref, anonId: ANON_ID }
    )
  }

  close(): void {
    this.readyState = 3
  }

  frames(): Record<string, unknown>[] {
    return this.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>)
  }

  private reply(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

/** Installs the fake for the duration of a test and restores whatever was there. */
export const withFakeEdge = (): (() => void) => {
  const original = (globalThis as { WebSocket?: unknown }).WebSocket
  FakeEdgeSocket.reset()
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeEdgeSocket

  return () => {
    ;(globalThis as { WebSocket?: unknown }).WebSocket = original
  }
}
