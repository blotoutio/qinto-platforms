import { Redirect, shared } from '@shoplineos/app-bridge'

import { bridge, isEmbedded } from './app-bridge'

/**
 * An error carrying what the backend actually said.
 *
 * `code` is the Qinto slug passed through by the Worker — `already_exists`, `host_not_ready` — which
 * the setup screens turn into specific copy. Collapsing it into a message would lose that.
 */
export class ApiError extends Error {
  readonly status: number
  readonly error: string
  readonly code: string | undefined
  readonly detail: string | undefined

  constructor(status: number, body: { error?: string; code?: string; detail?: string; message?: string }) {
    super(body.detail ?? body.message ?? body.error ?? `request failed with ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.error = body.error ?? 'unknown'
    this.code = body.code
    this.detail = body.detail
  }
}

/**
 * Sends the merchant back through install when the session token is no longer accepted.
 *
 * The Worker signals this with a header rather than a body, because it has to work for a request
 * whose body the caller never reads.
 */
const reauthorizeIfAsked = (response: Response): void => {
  if (response.headers.get('X-SHOPLINE-API-Request-Failure-Reauthorize') !== '1') {
    return
  }

  const path = response.headers.get('X-SHOPLINE-API-Request-Failure-Reauthorize-Url') ?? '/api/auth'
  const url = path.startsWith('/') ? `https://${window.location.host}${path}` : path
  Redirect.create(bridge()).replaceTo(url)
}

/**
 * Every call to our Worker.
 *
 * Goes through `shared.authenticatedFetch`, which attaches the session token — the only thing that
 * tells the Worker which store is calling. Nothing here holds a credential of its own.
 */
export const api = async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
  const request = isEmbedded() ? shared.authenticatedFetch(bridge()) : window.fetch
  const response = await request(path, {
    method: init?.method ?? 'GET',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) })
  })

  reauthorizeIfAsked(response)

  const body = (await response.json().catch(() => ({}))) as Record<string, string>
  if (!response.ok) {
    throw new ApiError(response.status, body)
  }

  return body as T
}
