import { afterEach, describe, expect, it, vi } from 'vitest'

import { hostCalls } from '../test/setup'
import { ApiError, api } from './api'

const original = globalThis.fetch

afterEach(() => {
  globalThis.fetch = original
  hostCalls.reset()
})

const answer = (body: unknown, init: ResponseInit = {}) => {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, ...init }))
  ) as typeof fetch
}

describe('api', () => {
  it('marks itself as an XHR, which the backend and SHOPLINE both expect', async () => {
    answer({ ok: true })

    await api('/api/status')

    const init = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('X-Requested-With')).toBe('XMLHttpRequest')
  })

  it('sends no content-type on a bodyless call', async () => {
    answer({ ok: true })

    await api('/api/status')

    const init = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('Content-Type')).toBeNull()
  })

  it('serializes a body and names its type', async () => {
    answer({ ok: true })

    await api('/api/settings/tracking', { method: 'PUT', body: { enabled: false } })

    const init = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]?.[1]
    expect(init?.body).toBe('{"enabled":false}')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
  })

  it('carries the backend’s error slug and code, so a screen can write specific copy', async () => {
    answer({ error: 'qinto_api', code: 'already_exists', detail: 'taken' }, { status: 502 })

    const error = (await api('/api/setup/site').catch((thrown: unknown) => thrown)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 502, error: 'qinto_api', code: 'already_exists', message: 'taken' })
  })

  it('prefers detail, then message, then the slug for its message', async () => {
    answer({ error: 'internal', message: 'a message' }, { status: 500 })
    await expect(api('/x')).rejects.toThrow('a message')

    answer({ error: 'internal' }, { status: 500 })
    await expect(api('/x')).rejects.toThrow('internal')
  })

  it('falls back to the status when the body says nothing', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('<html>', { status: 503 }))) as typeof fetch

    await expect(api('/x')).rejects.toThrow('request failed with 503')
  })

  it('sends the merchant back through install when the token is no longer accepted', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'unauthenticated' }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'X-SHOPLINE-API-Request-Failure-Reauthorize': '1',
            'X-SHOPLINE-API-Request-Failure-Reauthorize-Url': '/api/auth'
          }
        })
      )
    ) as typeof fetch

    await expect(api('/api/status')).rejects.toThrow(ApiError)
    expect(hostCalls.redirects).toEqual([`https://${window.location.host}/api/auth`])
  })

  it('follows an absolute reauthorization URL as given', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response('{}', {
          status: 401,
          headers: {
            'X-SHOPLINE-API-Request-Failure-Reauthorize': '1',
            'X-SHOPLINE-API-Request-Failure-Reauthorize-Url': 'https://elsewhere.example.com/auth'
          }
        })
      )
    ) as typeof fetch

    await api('/api/status').catch(() => undefined)

    expect(hostCalls.redirects).toEqual(['https://elsewhere.example.com/auth'])
  })

  it('defaults the reauthorization path when the header omits it', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 401, headers: { 'X-SHOPLINE-API-Request-Failure-Reauthorize': '1' } }))
    ) as typeof fetch

    await api('/api/status').catch(() => undefined)

    expect(hostCalls.redirects).toEqual([`https://${window.location.host}/api/auth`])
  })

  it('does not redirect on an ordinary failure', async () => {
    answer({ error: 'internal' }, { status: 500 })

    await api('/x').catch(() => undefined)

    expect(hostCalls.redirects).toEqual([])
  })
})
