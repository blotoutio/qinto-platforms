import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from './schema'

export type Db = DrizzleD1Database<typeof schema>

/**
 * Wraps the request's D1 binding in a Drizzle instance.
 *
 * There is no pool and nothing to close: D1 is a binding, not a connection.
 */
export const openDb = (d1: D1Database): Db => {
  return drizzle(d1, { schema })
}
