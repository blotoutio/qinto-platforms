import { Hono } from 'hono'
import { z } from 'zod'

import { isReturnUrlFor, isSiteUrl } from '../common/urls'
import { randomHex } from '../crypto/hmac'
import { createRegistration } from '../db/queries/registrations'
import type { AppEnv } from '../http/context'
import { readJsonBody } from '../http/validate'

export const register = new Hono<AppEnv>()

const registerBody = z
  .object({ shopId: z.string().max(2048), returnUrl: z.string().max(2048) })
  .refine((body) => isSiteUrl(body.shopId), { message: 'shopId must be the https site URL' })
  .refine((body) => isReturnUrlFor(body.returnUrl, body.shopId), {
    message: "returnUrl must be the site's own https wp-admin/admin-post.php"
  })

/** The one unauthenticated write: rate-limited by IP, unverified until `/connect`, swept if never verified. */
register.post('/register', async (c) => {
  const { success } = await c.env.REGISTER_LIMITER.limit({ key: c.req.header('cf-connecting-ip') ?? 'unknown' })
  if (!success) {
    return c.json({ error: 'rate_limited' }, 429)
  }

  const body = await readJsonBody(c, registerBody)
  const registrationId = crypto.randomUUID()
  const secret = randomHex(32)
  await createRegistration(c.get('db'), c.get('config'), { id: registrationId, secret, ...body })

  return c.json({ registrationId, secret }, 201)
})
