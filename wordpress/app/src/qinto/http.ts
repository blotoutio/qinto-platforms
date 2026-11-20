import type { z } from 'zod'

import type { AppConfig } from '../config'

export class QintoApiError extends Error {
  readonly status: number
  /** Qinto's error slug, e.g. `forbidden`, `already_exists`, `acknowledgement_required`. */
  readonly code: string

  constructor(path: string, status: number, code: string) {
    super(`Qinto ${path} -> ${status} ${code}`)
    this.name = 'QintoApiError'
    this.status = status
    this.code = code
  }
}

/** Qinto answered 2xx with a body we do not understand: a bug on one side, never a merchant state. */
export class QintoContractError extends Error {
  constructor(path: string, issues: string) {
    super(`Qinto ${path} returned an unexpected body: ${issues}`)
    this.name = 'QintoContractError'
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH'

type Call<S extends z.ZodType> = { method: Method; path: string; schema: S; body?: unknown }

const send = async <S extends z.ZodType>(
  config: AppConfig,
  token: string,
  { method, path, schema, body }: Call<S>
): Promise<z.output<S>> => {
  const headers: Record<string, string> =
    body === undefined ? { Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const response = await fetch(`${config.qintoApiOrigin}${path}`, {
    method,
    headers,
    body: body === undefined ? null : JSON.stringify(body)
  })

  const json: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const slug = (json as { error?: unknown }).error
    throw new QintoApiError(path, response.status, typeof slug === 'string' ? slug : 'unknown')
  }

  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new QintoContractError(path, parsed.error.message)
  }

  return parsed.data
}

export type QintoApi = {
  get: <S extends z.ZodType>(path: string, schema: S) => Promise<z.output<S>>
  post: <S extends z.ZodType>(path: string, schema: S, body?: unknown) => Promise<z.output<S>>
  put: <S extends z.ZodType>(path: string, schema: S, body?: unknown) => Promise<z.output<S>>
  patch: <S extends z.ZodType>(path: string, schema: S, body?: unknown) => Promise<z.output<S>>
}

/** The Qinto API under one bearer token. Every response is parsed by its schema. */
export const qintoApi = (config: AppConfig, token: string): QintoApi => ({
  get: (path, schema) => send(config, token, { method: 'GET', path, schema }),
  post: (path, schema, body) => send(config, token, { method: 'POST', path, schema, body }),
  put: (path, schema, body) => send(config, token, { method: 'PUT', path, schema, body }),
  patch: (path, schema, body) => send(config, token, { method: 'PATCH', path, schema, body })
})
