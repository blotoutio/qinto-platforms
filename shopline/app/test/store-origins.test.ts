import { describe, expect, it } from 'vitest'

import { assessOrigins, storeOrigins } from '../src/services/store-origins'

const ROOT = 'srini-shopline.com'

describe('storeOrigins', () => {
  it('lists the SHOPLINE host and the primary domain as https origins', () => {
    expect(storeOrigins('srini-test', 'myshopline.com', 'Shop.Example.com')).toEqual([
      'https://srini-test.myshopline.com',
      'https://shop.example.com'
    ])
  })

  it('does not repeat a primary domain that is the SHOPLINE host', () => {
    expect(storeOrigins('srini-test', 'myshopline.com', 'srini-test.myshopline.com')).toEqual(['https://srini-test.myshopline.com'])
  })

  it('drops a primary domain that is not a hostname', () => {
    expect(storeOrigins('srini-test', 'myshopline.com', 'not a host/')).toEqual(['https://srini-test.myshopline.com'])
  })
})

describe('assessOrigins', () => {
  const wanted = ['https://srini-test.myshopline.com', 'https://www.srini-shopline.com']

  it('leaves the list alone when the site does not check origins', () => {
    expect(assessOrigins({ originCheck: false, allowedOrigins: [] }, wanted, ROOT)).toEqual({ state: 'check_off', missing: [] })
  })

  it('treats the root domain and its subdomains as already allowed', () => {
    const status = assessOrigins({ originCheck: true, allowedOrigins: ['https://srini-test.myshopline.com'] }, wanted, ROOT)

    expect(status).toEqual({ state: 'allowed', missing: [] })
  })

  it('reports what is missing when there is room', () => {
    expect(assessOrigins({ originCheck: true, allowedOrigins: [] }, wanted, ROOT)).toEqual({
      state: 'missing',
      missing: ['https://srini-test.myshopline.com']
    })
  })

  it('reports a list that cannot take another entry as full', () => {
    const allowedOrigins = Array.from({ length: 20 }, (_, index) => `https://o${index}.example.com`)

    expect(assessOrigins({ originCheck: true, allowedOrigins }, wanted, ROOT).state).toBe('full')
  })
})
