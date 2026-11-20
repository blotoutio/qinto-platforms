import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from './schema'

export type Db = DrizzleD1Database<typeof schema>

export const openDb = (d1: D1Database): Db => {
  return drizzle(d1, { schema })
}
