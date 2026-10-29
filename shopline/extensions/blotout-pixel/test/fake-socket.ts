/**
 * A stand-in for the sandbox's `WebSocket`.
 *
 * The pixel's whole job is to put the right JSON on a socket, so the socket is what gets faked —
 * everything above it, including the queue and the backoff, is exercised for real.
 */
export class FakeSocket {
  static instances: FakeSocket[] = []
  static failConstruction = false

  static reset(): void {
    FakeSocket.instances = []
    FakeSocket.failConstruction = false
  }

  static get last(): FakeSocket | undefined {
    return FakeSocket.instances.at(-1)
  }

  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly url: string
  readonly sent: string[] = []
  readyState = FakeSocket.CONNECTING
  sendThrows = false

  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(url: string) {
    if (FakeSocket.failConstruction) {
      throw new Error('blocked by the sandbox')
    }

    this.url = url
    FakeSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(payload: string): void {
    if (this.sendThrows) {
      throw new Error('send failed')
    }

    this.sent.push(payload)
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED
  }

  /** Drives the handshake the way the browser would. */
  open(): void {
    this.readyState = FakeSocket.OPEN
    this.emit('open', {})
  }

  message(data: unknown): void {
    this.emit('message', { data })
  }

  fail(): void {
    this.emit('error', {})
  }

  closeFromServer(): void {
    this.readyState = FakeSocket.CLOSED
    this.emit('close', {})
  }

  frames(): Record<string, unknown>[] {
    return this.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>)
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

/** Installs the fake for the duration of a test and restores whatever was there. */
export const withFakeSocket = (): (() => void) => {
  const original = (globalThis as { WebSocket?: unknown }).WebSocket
  FakeSocket.reset()
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket

  return () => {
    ;(globalThis as { WebSocket?: unknown }).WebSocket = original
  }
}
