import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from './App'
import type { Status } from './lib/types'
import { chooseStatus, connectStatus, readyStatus } from './test/fixtures'
import type { HttpStub } from './test/http'
import { stubHttp } from './test/http'
import { hostCalls } from './test/setup'

let http: HttpStub

const mount = async (status: Status | { status: number; body: unknown }, extra: Record<string, unknown> = {}) => {
  http = stubHttp(({ path }) => {
    if (path === '/api/status') {
      return 'screen' in status ? { body: status } : status
    }

    const match = Object.entries(extra).find(([route]) => path.startsWith(route))

    return match === undefined ? { body: {} } : (match[1] as { status?: number; body?: unknown })
  })

  render(<App />)
  await waitFor(() => {
    expect(http.calls.some((call) => call.path === '/api/status')).toBe(true)
  })
}

beforeEach(() => {
  hostCalls.reset()
})

afterEach(() => {
  cleanup()
  http?.restore()
})

describe('screen routing', () => {
  it('shows the connect banner as the whole first screen', async () => {
    await mount(connectStatus())

    expect(await screen.findByRole('button', { name: 'Connect with Qinto' })).toBeTruthy()
    // Nothing else is offered: there is no setting worth showing until a Qinto user has authorized.
    expect(screen.queryByText('Tracking')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })

  it('names both sides of the connection, whether or not the store name is known', async () => {
    // The heading names the app and the platform rather than the store: the merchant is authorizing
    // a Qinto account, and the store name told them nothing they did not already know.
    await mount(connectStatus())
    expect(await screen.findByText('Connect Blotout to Qinto')).toBeTruthy()

    await mount(connectStatus({ store: { handle: 'x', shopName: null, primaryDomain: null, usesDefaultDomain: true } }))
    expect(await screen.findAllByText('Connect Blotout to Qinto')).not.toHaveLength(0)
  })

  it('explains a revoked grant rather than looking like a first install', async () => {
    await mount(connectStatus({ connection: { connected: false, reason: 'revoked' } }))

    expect(await screen.findByText(/no longer valid/)).toBeTruthy()
  })

  it('tells the truth about what a revocation did — nothing on the storefront changed', async () => {
    await mount(connectStatus({ connection: { connected: false, reason: 'revoked' } }))

    // The backend leaves the selection and pixel alone on a revocation, so the copy must not claim
    // tracking stopped.
    expect(await screen.findByText(/still sending to the same site/)).toBeTruthy()
    expect(screen.queryByText(/switched off|forgotten/)).toBeNull()
  })

  it('shows the site chooser once connected', async () => {
    await mount(chooseStatus(), { '/api/qinto/teams': { body: { teams: [] } } })

    expect(await screen.findByText('Choose a site')).toBeTruthy()
  })

  it('shows the ready screen once a site is selected', async () => {
    await mount(readyStatus())

    expect(await screen.findByText('Tracking')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
  })

  it('resumes onboarding at the step the server remembers', async () => {
    await mount(
      readyStatus({
        screen: 'onboarding',
        selection: null,
        onboarding: { step: 'dns', teamId: 'team-1', domainId: 'domain-1', rootDomain: 'srini-shopline.com' }
      }),
      { '/api/setup/dns': { body: { records: [], valid: false, required: true, checked: true, failureKind: null, message: '' } } }
    )

    expect(await screen.findByText('Publish these DNS records')).toBeTruthy()
  })

  it('shows a load failure with a way out', async () => {
    await mount({ status: 500, body: { error: 'internal' } })

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('the connect action', () => {
  it('opens Qinto at the top level, because the consent screen refuses an iframe', async () => {
    await mount(connectStatus(), {
      '/api/qinto/connect': { body: { authorizeUrl: 'https://portal.qinto.tech/oauth/authorize?state=abc' } }
    })

    const button = await screen.findByRole('button', { name: 'Connect with Qinto' })
    button.click()

    await waitFor(() => {
      expect(hostCalls.redirects).toEqual(['https://portal.qinto.tech/oauth/authorize?state=abc'])
    })
  })

  it('reports a failure and lets the merchant retry', async () => {
    await mount(connectStatus(), { '/api/qinto/connect': { status: 500, body: { error: 'internal' } } })

    ;(await screen.findByRole('button', { name: 'Connect with Qinto' })).click()

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.level === 'error')).toBe(true)
    })
    expect(await screen.findByRole('button', { name: 'Connect with Qinto' })).toBeTruthy()
  })
})
