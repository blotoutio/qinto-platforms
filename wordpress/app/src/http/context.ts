import type { Context } from 'hono'

import type { AppConfig } from '../config'
import type { Db } from '../db/client'
import type { Registration } from '../db/queries/registrations'
import type { QintoApi } from '../qinto/http'
import { qintoApi } from '../qinto/http'
import { loadAccessToken } from '../services/connection-store'

/** `registration` and `body` are set only by `requireSignature`, so a route reading them is behind it. */
export type AppEnv = {
  Bindings: Env
  Variables: {
    config: AppConfig
    db: Db
    registration: Registration
    body: string
  }
}

/** The Qinto API under the signed-in install's grant. */
export const qintoApiFor = async (c: Context<AppEnv>): Promise<QintoApi> => {
  const config = c.get('config')
  const accessToken = await loadAccessToken(c.get('db'), config, c.get('registration').id)

  return qintoApi(config, accessToken)
}
