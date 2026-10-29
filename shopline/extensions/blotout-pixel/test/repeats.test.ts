import { describe, expect, it } from 'vitest'

import { distinctBy } from '../src/repeats'

describe('distinctBy', () => {
  it('admits the first value', () => {
    expect(distinctBy<string>((value) => value)('a')).toBe(true)
  })

  it('rejects an immediate repeat and admits the value after it changes back', () => {
    const changed = distinctBy<string>((value) => value)

    expect([changed('a'), changed('a'), changed('b'), changed('a')]).toEqual([true, false, true, true])
  })

  it('compares the identity, not the value', () => {
    const changed = distinctBy<{ id: string; at: number }>((value) => value.id)

    expect([changed({ id: 'x', at: 1 }), changed({ id: 'x', at: 2 })]).toEqual([true, false])
  })
})
