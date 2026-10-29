/** A `fetch` stand-in routed by path, so one stub covers a whole screen's calls. */
export type Route = (request: { path: string; method: string; body: unknown }) => { status?: number; body?: unknown }

export type HttpStub = {
  calls: { path: string; method: string; body: unknown }[]
  restore: () => void
}

export const stubHttp = (route: Route): HttpStub => {
  const original = globalThis.fetch
  const calls: HttpStub['calls'] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ path, method, body })

    const answer = route({ path, method, body })

    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }) as typeof fetch

  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    }
  }
}
