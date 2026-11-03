import { describe, expect, it } from 'vitest'

import { installWorkerShims } from '../src/worker-shims'

describe('installWorkerShims', () => {
  it('gives a worker scope the window and document the SDK needs', () => {
    const scope: Record<string, unknown> = {}

    installWorkerShims(scope)

    expect(scope['window']).toBe(scope)
    const document = scope['document'] as Record<string, unknown>
    expect(document['visibilityState']).toBe('visible')
    // A missing cookie is what breaks the SDK's capture step; an empty one is read as no cookies.
    expect(document['cookie']).toBe('')
    expect((document['addEventListener'] as () => unknown)()).toBeUndefined()
    expect((document['removeEventListener'] as () => unknown)()).toBeUndefined()
  })

  it('lets the SDK inject q.js without throwing, and reports the script loaded at once', () => {
    const scope: Record<string, unknown> = {}
    installWorkerShims(scope)
    const document = scope['document'] as {
      createElement: (tag: string) => { onload: (() => void) | null; onerror: (() => void) | null; dataset: object }
      head: { appendChild: <T>(node: T) => T }
    }

    const script = document.createElement('script')
    let loaded = 0
    let failed = 0
    script.onload = () => loaded++
    script.onerror = () => failed++

    expect(script.dataset).toEqual({})
    expect(document.head.appendChild(script)).toBe(script)
    expect(loaded).toBe(1)
    expect(failed).toBe(0)
  })

  it('appends a node with no onload without throwing', () => {
    const scope: Record<string, unknown> = {}
    installWorkerShims(scope)
    const document = scope['document'] as { head: { appendChild: <T>(node: T) => T } }

    expect(() => document.head.appendChild({})).not.toThrow()
  })

  it('leaves a real window and document alone', () => {
    const window = { real: true }
    const document = { cookie: 'a=1' }
    const scope: Record<string, unknown> = { window, document }

    installWorkerShims(scope)

    expect(scope['window']).toBe(window)
    expect(scope['document']).toBe(document)
  })

  it('defaults to the global scope', () => {
    const global = globalThis as Record<string, unknown>

    installWorkerShims()

    expect(global['window']).toBe(globalThis)
    delete global['window']
    delete global['document']
  })
})
