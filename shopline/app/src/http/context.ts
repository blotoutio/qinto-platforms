import type { AppConfig } from '../config'
import type { Db } from '../db/client'

/**
 * What every request carries.
 *
 * `handle` and `staffSubject` are set only by `requireSession`, so a route that reads them is
 * necessarily behind it.
 */
export type AppEnv = {
  Bindings: Env
  Variables: {
    config: AppConfig
    db: Db
    handle: string
    staffSubject: string
  }
}
