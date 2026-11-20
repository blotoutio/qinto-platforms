import { createMiddleware } from 'hono/factory'

import { readConfig } from '../config'
import { openDb } from '../db/client'
import { verifySignedRequest } from '../services/signature'
import type { AppEnv } from './context'

export const withContext = createMiddleware<AppEnv>(async (c, next) => {
  c.set('config', readConfig(c.env))
  c.set('db', openDb(c.env.DB))

  return next()
})

const signed = (allowUnverified: boolean) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const body = await c.req.text()
    const request = { headers: c.req.raw.headers, method: c.req.method, url: c.req.url, body }
    const result = await verifySignedRequest(c.get('db'), c.get('config'), request, { allowUnverified })
    if (!result.ok) {
      return c.json({ error: result.reason }, 401)
    }

    c.set('registration', result.registration)
    c.set('body', body)

    return next()
  })

/** The only thing that says which install is calling; no route takes a registration id from input. */
export const requireSignature = signed(false)

/** Only for `POST /connect`, which proves site ownership itself. */
export const requireSignatureUnverified = signed(true)
