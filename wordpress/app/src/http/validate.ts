import type { Context } from 'hono'
import { z } from 'zod'

import type { AppEnv } from './context'

/** `onError` turns it into a 400. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
}

const parseWith = <S extends z.ZodType>(schema: S, value: unknown): z.output<S> => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new BadRequestError(z.prettifyError(parsed.error))
  }

  return parsed.data
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    throw new BadRequestError('body must be JSON')
  }
}

/** The exact body bytes `requireSignature` verified, parsed. */
export const readSignedBody = <S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.output<S> => {
  return parseWith(schema, parseJson(c.get('body')))
}

export const readJsonBody = async <S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> => {
  return parseWith(schema, parseJson(await c.req.text()))
}

export const readQuery = <S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.output<S> => parseWith(schema, c.req.query())

/** Qinto ids are UUIDs; checked before they go into an API path. */
export const qintoId = z.guid()

export const siteRefSchema = z.object({ teamId: qintoId, domainId: qintoId })
