import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Status } from '../lib/types'
import { chooseStatus } from '../test/fixtures'
import type { HttpStub, Route } from '../test/http'
import { stubHttp } from '../test/http'
import { hostCalls } from '../test/setup'
import { OnboardingScreen } from './OnboardingScreen'

let http: HttpStub

const DNS = {
  records: [{ type: 'CNAME', name: 'xfbaos', value: 'edge.qinto.tech', note: 'Disable the proxy.' }],
  valid: false,
  required: true,
  checked: true,
  failureKind: null,
  message: 'Waiting for the CNAME.'
}

const show = (status: Status, route: Route) => {
  http = stubHttp(route)
  const onDone = vi.fn(() => Promise.resolve())
  const onCancel = vi.fn()
  render(<OnboardingScreen status={status} teamId='team-1' onDone={onDone} onCancel={onCancel} />)

  return { onDone, onCancel }
}

const suggestions = (hosts: { host: string; source: string; isDefault: boolean }[]) => ({ body: { suggestions: hosts } })

beforeEach(() => {
  hostCalls.reset()
})

afterEach(() => {
  cleanup()
  http?.restore()
})

describe('the domain step', () => {
  it('starts at the domain step for a fresh flow', async () => {
    show(chooseStatus(), () => suggestions([]))

    expect(await screen.findByText('Which domain should Qinto measure?')).toBeTruthy()
  })

  it('offers the storefront domain and the team’s existing site domains', async () => {
    show(chooseStatus(), ({ path }) =>
      path.startsWith('/api/qinto/domain-suggestions')
        ? suggestions([
            { host: 'shop.example.com', source: 'shopline_primary', isDefault: false },
            { host: 'other.example.com', source: 'qinto_site', isDefault: false }
          ])
        : { body: {} }
    )

    expect(await screen.findByText('shop.example.com')).toBeTruthy()
    expect(screen.getByText('other.example.com')).toBeTruthy()
  })

  it('offers a SHOPLINE-owned domain but refuses to let it be chosen', async () => {
    show(
      chooseStatus({ store: { handle: 'srini-test', shopName: 'x', primaryDomain: 'srini-test.myshopline.com', usesDefaultDomain: true } }),
      () => suggestions([{ host: 'srini-test.myshopline.com', source: 'shopline_primary', isDefault: true }])
    )

    const button = await screen.findByRole('button', { name: /srini-test\.myshopline\.com/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it("names the store's own SHOPLINE host when the Admin API never told us the domain", async () => {
    // The ordinary case for this app's scopes: `primaryDomain` is null and the backend derives the
    // host from the handle, so the warning still names something the merchant recognizes.
    show(chooseStatus({ store: { handle: 'srini-test', shopName: null, primaryDomain: null, usesDefaultDomain: true } }), () =>
      suggestions([{ host: 'srini-test.myshopline.com', source: 'shopline_default', isDefault: true }])
    )

    expect(await screen.findByText('srini-test.myshopline.com')).toBeTruthy()
    const button = await screen.findByRole('button', { name: /srini-test\.myshopline\.com · your SHOPLINE storefront/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('warns a store still on myshopline.com what it will cost them', async () => {
    show(
      chooseStatus({ store: { handle: 'srini-test', shopName: 'x', primaryDomain: 'srini-test.myshopline.com', usesDefaultDomain: true } }),
      () => suggestions([])
    )

    expect(await screen.findByText(/cannot serve from a/)).toBeTruthy()
  })

  it('refuses a blank domain before calling the backend', async () => {
    show(chooseStatus(), () => suggestions([]))

    fireEvent.click(await screen.findByRole('button', { name: 'Create the site' }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.level === 'error')).toBe(true)
    })
    expect(http.calls.every((call) => call.path !== '/api/setup/site')).toBe(true)
  })

  it('creates the site and moves to the DNS step', async () => {
    show(chooseStatus(), ({ path }) => {
      if (path.startsWith('/api/qinto/domain-suggestions')) {
        return suggestions([{ host: 'shop.example.com', source: 'shopline_primary', isDefault: false }])
      }

      if (path === '/api/setup/site') {
        return { body: { site: { domainId: 'domain-9' } } }
      }

      return { body: DNS }
    })

    fireEvent.click(await screen.findByRole('button', { name: /shop\.example\.com/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create the site' }))

    expect(await screen.findByText('Publish these DNS records')).toBeTruthy()
    expect(http.calls.find((call) => call.path === '/api/setup/site')?.body).toEqual({ teamId: 'team-1', rootDomain: 'shop.example.com' })
  })

  it('explains a hostname that is already taken instead of showing a raw error', async () => {
    show(chooseStatus(), ({ path }) => {
      if (path.startsWith('/api/qinto/domain-suggestions')) {
        return suggestions([{ host: 'shop.example.com', source: 'shopline_primary', isDefault: false }])
      }

      return { status: 502, body: { error: 'qinto_api', code: 'already_exists' } }
    })

    fireEvent.click(await screen.findByRole('button', { name: /shop\.example\.com/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create the site' }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message.includes('already serves that hostname'))).toBe(true)
    })
  })
})

describe('the DNS step', () => {
  const atDns = (route: Route) =>
    show(chooseStatus({ onboarding: { step: 'dns', teamId: 'team-1', domainId: 'domain-9', rootDomain: 'shop.example.com' } }), route)

  it('resumes at DNS when the server remembers that step', async () => {
    atDns(() => ({ body: DNS }))

    // Propagation can take hours; restarting the flow would be the wrong answer to a merchant
    // who closed the app and came back.
    expect(await screen.findByText('Publish these DNS records')).toBeTruthy()
  })

  it('shows each record with its note', async () => {
    atDns(() => ({ body: DNS }))

    expect(await screen.findByText('CNAME')).toBeTruthy()
    expect(screen.getByText('edge.qinto.tech')).toBeTruthy()
    expect(screen.getByText('Disable the proxy.')).toBeTruthy()
    expect(screen.getByText('Waiting for the CNAME.')).toBeTruthy()
  })

  it('emails the records to whoever manages DNS', async () => {
    // The merchant setting the app up is often not the person who can edit DNS, and the alternative
    // is copying two records out of an iframe by hand.
    atDns(({ path }) => (path === '/api/setup/dns/share' ? { body: { sent: 1 } } : { body: DNS }))

    fireEvent.change(await screen.findByLabelText('Email addresses'), { target: { value: 'dns-admin@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))

    expect(await screen.findByText('Instructions sent to 1 address.')).toBeTruthy()
    expect(http.calls.find((call) => call.path === '/api/setup/dns/share')).toMatchObject({
      method: 'POST',
      body: { teamId: 'team-1', domainId: 'domain-9', emails: ['dns-admin@example.com'] }
    })
  })

  it('does not offer to share a site that needs no records', async () => {
    atDns(() => ({ body: { ...DNS, required: false } }))

    expect(await screen.findByText(/needs no DNS/)).toBeTruthy()
    expect(screen.queryByLabelText('Email addresses')).toBeNull()
  })

  it('advances to deploy once the check passes', async () => {
    atDns(({ path }) => ({ body: path === '/api/setup/dns/check' ? { ...DNS, valid: true, message: '' } : DNS }))

    fireEvent.click(await screen.findByRole('button', { name: 'Check DNS' }))

    expect(await screen.findByText('Deploy the site')).toBeTruthy()
    expect(hostCalls.toasts.some((toast) => toast.message === 'DNS verified')).toBe(true)
  })

  it('stays put and says why when the records are not in place', async () => {
    atDns(({ path }) => ({ body: path === '/api/setup/dns/check' ? DNS : DNS }))

    fireEvent.click(await screen.findByRole('button', { name: 'Check DNS' }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message === 'Waiting for the CNAME.')).toBe(true)
    })
    expect(screen.getByText('Publish these DNS records')).toBeTruthy()
  })

  it('reports a check that could not run at all as an error', async () => {
    atDns(({ path }) =>
      path === '/api/setup/dns/check'
        ? { body: { ...DNS, checked: false, failureKind: 'host_not_ready', message: 'The host is not ready.' } }
        : { body: DNS }
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Check DNS' }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.level === 'error' && toast.message === 'The host is not ready.')).toBe(true)
    })
  })

  it('falls back to plain copy when the check reports nothing useful', async () => {
    atDns(({ path }) => ({ body: path === '/api/setup/dns/check' ? { ...DNS, message: '' } : DNS }))

    fireEvent.click(await screen.findByRole('button', { name: 'Check DNS' }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message.includes('can take a while to propagate'))).toBe(true)
    })
  })

  it('skips straight past DNS when the site needs none', async () => {
    atDns(({ path }) => ({ body: path === '/api/setup/dns/check' ? { ...DNS, required: false } : { ...DNS, required: false } }))

    expect(await screen.findByText(/needs no DNS/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check DNS' }))
    expect(await screen.findByText('Deploy the site')).toBeTruthy()
  })

  it('reloads the records on request', async () => {
    atDns(() => ({ body: DNS }))

    fireEvent.click(await screen.findByRole('button', { name: 'Reload records' }))

    await waitFor(() => {
      expect(http.calls.filter((call) => call.path.startsWith('/api/setup/dns?')).length).toBeGreaterThan(1)
    })
  })

  it('reports a failure to read the records', async () => {
    atDns(() => ({ status: 502, body: { error: 'qinto_api', code: 'not_found' } }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.level === 'error')).toBe(true)
    })
  })
})

describe('the deploy step', () => {
  const atDeploy = (route: Route) =>
    show(chooseStatus({ onboarding: { step: 'deploy', teamId: 'team-1', domainId: 'domain-9', rootDomain: 'shop.example.com' } }), route)

  it('deploys and reports that tracking is on', async () => {
    const { onDone } = atDeploy(() => ({ body: { deployment: { version: '1.4.0' }, deliveryLive: true, tracking: { live: true } } }))

    fireEvent.click(await screen.findByRole('button', { name: 'Deploy and start tracking' }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message.includes('Tracking is on'))).toBe(true)
    })
    expect(onDone).toHaveBeenCalled()
  })

  it('says why tracking is not on yet rather than claiming it is', async () => {
    atDeploy(() => ({ body: { deployment: { version: '1' }, deliveryLive: false, tracking: { live: false, error: 'push failed' } } }))

    fireEvent.click(await screen.findByRole('button', { name: 'Deploy and start tracking' }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message === 'push failed')).toBe(true)
    })
  })

  it('falls back to plain copy when the backend gives no reason', async () => {
    atDeploy(() => ({ body: { deployment: { version: '1' }, deliveryLive: false, tracking: { live: false } } }))

    fireEvent.click(await screen.findByRole('button', { name: 'Deploy and start tracking' }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message.includes('once the site is serving'))).toBe(true)
    })
  })

  it('reports a failed deploy', async () => {
    atDeploy(() => ({ status: 502, body: { error: 'qinto_api', code: 'host_not_ready', detail: 'the host is not ready' } }))

    fireEvent.click(await screen.findByRole('button', { name: 'Deploy and start tracking' }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message === 'the host is not ready')).toBe(true)
    })
  })

  it('lets the merchant go back to DNS', async () => {
    atDeploy(() => ({ body: DNS }))

    fireEvent.click(await screen.findByRole('button', { name: 'Back to DNS' }))

    expect(await screen.findByText('Publish these DNS records')).toBeTruthy()
  })
})

describe('leaving', () => {
  it('hands control back to the shell', async () => {
    const { onCancel } = show(chooseStatus(), () => suggestions([]))

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))

    expect(onCancel).toHaveBeenCalled()
  })
})

describe('the deploy step', () => {
  it('tells the merchant how to switch on the optional custom-code block, which no API can do for them', async () => {
    // SHOPLINE does not activate an App Embed Block on install and offers no API to activate one,
    // so the route and the two clicks are all this app can honestly give.
    show(chooseStatus({ onboarding: { step: 'deploy', teamId: 'team-1', domainId: 'domain-9', rootDomain: 'srini-shopline.com' } }), () =>
      suggestions([])
    )

    expect(await screen.findByText(/Optional: your own tracking code/)).toBeTruthy()
    expect(screen.getByText('App embeds')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Online Store' }) as HTMLAnchorElement
    expect(link.href).toBe('https://srini-test.myshopline.com/admin/website/shopSetting')
  })
})
