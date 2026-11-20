import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv } from '../http/context'
import { qintoApiFor } from '../http/context'
import { requireSignature } from '../http/middleware'
import { readQuery, readSignedBody, siteRefSchema } from '../http/validate'
import { checkDns, getDns, shareDns } from '../qinto/dns'
import type { QintoApi } from '../qinto/http'
import type { SiteRef } from '../qinto/sites'
import { assertInScope } from '../services/site-scope'

export const dns = new Hono<AppEnv>()

const scopedApi = async (c: Context<AppEnv>, ref: SiteRef): Promise<QintoApi> => {
  await assertInScope(c.get('db'), c.get('registration').id, ref)

  return qintoApiFor(c)
}

/** Qinto's own cap on one send. */
const MAX_RECIPIENTS = 10

const shareBody = siteRefSchema.extend({
  emails: z.array(z.email()).min(1).max(MAX_RECIPIENTS),
  submissionId: z.guid()
})

dns.get('/dns', requireSignature, async (c) => {
  const ref = readQuery(c, siteRefSchema)

  return c.json(await getDns(await scopedApi(c, ref), ref))
})

dns.post('/dns/check', requireSignature, async (c) => {
  const ref = readSignedBody(c, siteRefSchema)

  return c.json(await checkDns(await scopedApi(c, ref), ref))
})

/** Emails the records to whoever manages the domain. Rate-limited per install. */
dns.post('/dns/share', requireSignature, async (c) => {
  const { emails, submissionId, ...ref } = readSignedBody(c, shareBody)
  const { success } = await c.env.SHARE_LIMITER.limit({ key: c.get('registration').id })
  if (!success) {
    return c.json({ error: 'rate_limited' }, 429)
  }

  return c.json(await shareDns(await scopedApi(c, ref), ref, { emails, submissionId }))
})
