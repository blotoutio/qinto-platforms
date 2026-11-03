import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Status } from '../lib/types'
import { readyStatus } from '../test/fixtures'
import type { HttpStub, Route } from '../test/http'
import { stubHttp } from '../test/http'
import { hostCalls } from '../test/setup'
import { ReadyScreen } from './ReadyScreen'

let http: HttpStub

const show = (status: Status, route: Route = () => ({ body: {} })) => {
  http = stubHttp(route)
  const onChanged = vi.fn(() => Promise.resolve())
  render(<ReadyScreen status={status} onChanged={onChanged} />)

  return { onChanged }
}

const toggle = () => screen.getByRole('checkbox', { name: 'Send events to Qinto' }) as HTMLInputElement

beforeEach(() => {
  hostCalls.reset()
})

afterEach(() => {
  cleanup()
  http?.restore()
})

describe('what the merchant sees', () => {
  it('reports tracking as live', () => {
    show(readyStatus())

    expect(screen.getByText('Live')).toBeTruthy()
    expect(toggle().checked).toBe(true)
  })

  it('shows the selected site and where events go', () => {
    show(readyStatus())

    expect(screen.getByText('srini-shopline.com')).toBeTruthy()
    expect(screen.getAllByText('q.srini-shopline.com').length).toBeGreaterThan(0)
    expect(screen.getByText('karri’s Team')).toBeTruthy()
  })

  it('never claims a token or scope the connection does not have', () => {
    show(readyStatus())

    expect(screen.getByText('team:read')).toBeTruthy()
    expect(screen.getByText('domain:write')).toBeTruthy()
  })
})

describe('the kill switch', () => {
  it('confirms before switching tracking off', async () => {
    show(readyStatus())
    toggle().click()

    await waitFor(() => {
      expect(hostCalls.modals).toHaveLength(1)
    })
    expect(hostCalls.modals[0]?.title).toBe('Stop tracking for this store?')
    // Nothing is sent until the merchant confirms.
    expect(http.calls).toHaveLength(0)
  })

  it('says when the change takes effect, rather than promising instant', async () => {
    show(readyStatus())
    toggle().click()

    await waitFor(() => {
      expect(hostCalls.modals[0]?.content).toContain('next page load')
    })
  })

  it('sends enabled=false once confirmed', async () => {
    const { onChanged } = show(readyStatus(), () => ({ body: { enabled: false, pushed: true } }))
    toggle().click()
    await waitFor(() => {
      expect(hostCalls.modals).toHaveLength(1)
    })
    await hostCalls.confirmLast()

    expect(http.calls[0]).toMatchObject({ path: '/api/settings/tracking', method: 'PUT', body: { enabled: false } })
    expect(onChanged).toHaveBeenCalled()
  })

  it('turns tracking back on without a confirmation, because nothing is lost', async () => {
    show(
      readyStatus({
        tracking: { enabled: false, pushedEnabled: false, live: false, lastPushError: null, lastPushReason: null, settingsPushedAt: null }
      }),
      () => ({
        body: { enabled: true, pushed: true }
      })
    )
    toggle().click()

    await waitFor(() => {
      expect(http.calls[0]).toMatchObject({ body: { enabled: true } })
    })
    expect(hostCalls.modals).toHaveLength(0)
  })

  it('reports a rejected change as an error, not a success', async () => {
    // The toast is worded from the reason, never from SHOPLINE's raw status: `-> 500` tells a
    // merchant nothing, and this one is not even their fault.
    show(readyStatus(), () => ({ body: { enabled: false, pushed: false, error: 'SHOPLINE 500', reason: 'extension_not_published' } }))
    toggle().click()
    await waitFor(() => {
      expect(hostCalls.modals).toHaveLength(1)
    })
    await hostCalls.confirmLast()

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.level === 'error' && toast.message.includes('no pixel on your store'))).toBe(true)
    })
    expect(hostCalls.toasts.some((toast) => toast.message.includes('SHOPLINE 500'))).toBe(false)
  })

  it('shows a standing banner while tracking is off, so nobody wonders why events stopped', () => {
    show(
      readyStatus({
        tracking: { enabled: false, pushedEnabled: false, live: false, lastPushError: null, lastPushReason: null, settingsPushedAt: null }
      })
    )

    expect(screen.getByText('Tracking is off for this store.')).toBeTruthy()
    expect(screen.getByText('Off')).toBeTruthy()
  })
})

describe('when SHOPLINE disagrees with the merchant', () => {
  const disagreeing = readyStatus({
    tracking: {
      enabled: false,
      pushedEnabled: true,
      live: false,
      lastPushError: 'SHOPLINE 500',
      lastPushReason: null,
      settingsPushedAt: null
    }
  })

  it('says the storefront may still be sending, rather than showing a false off', () => {
    show(disagreeing)

    // The whole reason `trackingEnabled` and `pushedEnabled` are separate columns.
    expect(screen.getByText('SHOPLINE has not applied your last change.')).toBeTruthy()
    expect(screen.getByText(/may still be doing the opposite/)).toBeTruthy()
  })

  it('explains the failure in terms the merchant can act on', () => {
    show(disagreeing)

    expect(screen.getByText('SHOPLINE did not accept the settings.')).toBeTruthy()
    // The raw upstream status is a log line, not copy — it named an endpoint and a number.
    expect(screen.queryByText('SHOPLINE 500')).toBeNull()
  })

  it('offers a retry that does not change the merchant’s intent', async () => {
    const { onChanged } = show(disagreeing, () => ({ body: { enabled: false, pushed: true } }))
    screen.getByRole('button', { name: 'Retry' }).click()

    await waitFor(() => {
      expect(http.calls[0]).toMatchObject({ path: '/api/settings/retry-push', method: 'POST' })
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('reports a retry that fails again', async () => {
    show(disagreeing, () => ({ body: { enabled: false, pushed: false, error: 'still failing', reason: 'unknown' } }))
    screen.getByRole('button', { name: 'Retry' }).click()

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message === 'SHOPLINE did not accept the settings.')).toBe(true)
    })
  })

  it('withholds the retry when retrying cannot possibly work', () => {
    // `extension_not_published` is ours to fix, not the merchant's to retry. Offering a button here
    // is how someone ends up pressing it all afternoon against a wall.
    show(
      readyStatus({
        tracking: {
          enabled: false,
          pushedEnabled: true,
          live: false,
          lastPushError: 'SHOPLINE pixel/update_config.json -> 500',
          lastPushReason: 'extension_not_published',
          settingsPushedAt: null
        }
      })
    )

    expect(screen.getByText(/no pixel on your store for this app yet/)).toBeTruthy()
    // Not "Retry", which would imply the push itself was the problem.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
  })
})

describe('when tracking is on but not arriving', () => {
  it('says the site is not serving yet', () => {
    show(
      readyStatus({
        selection: { ...(readyStatus().selection as NonNullable<Status['selection']>), deliveryLive: false },
        tracking: { enabled: true, pushedEnabled: true, live: false, lastPushError: null, lastPushReason: null, settingsPushedAt: null }
      })
    )

    expect(screen.getByText(/not serving yet/)).toBeTruthy()
    expect(screen.getByText('Not sending')).toBeTruthy()
  })

  const notPublished = () =>
    readyStatus({
      tracking: {
        enabled: true,
        pushedEnabled: null,
        live: false,
        lastPushError: 'SHOPLINE pixel/update_config.json -> 500',
        lastPushReason: 'extension_not_published',
        settingsPushedAt: null
      }
    })

  it('does not promise a push can fix something publishing has to fix', () => {
    show(notPublished())

    expect(screen.getByText(/fixed by publishing the app, not from here/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Push them now' })).toBeNull()
  })

  it('still offers a way to clear the card once someone has published', async () => {
    // Without this the message outlives the problem: nothing else in the app re-pushes, so the card
    // would keep reporting a failure that was already fixed elsewhere.
    show(notPublished(), () => ({ body: { enabled: true, pushed: true } }))

    ;(await screen.findByRole('button', { name: 'Check again' })).click()

    await waitFor(() => {
      expect(http.calls[0]).toMatchObject({ path: '/api/settings/retry-push', method: 'POST' })
    })
  })

  it('offers to push settings that have never reached SHOPLINE', async () => {
    show(
      readyStatus({
        tracking: { enabled: true, pushedEnabled: null, live: false, lastPushError: null, lastPushReason: null, settingsPushedAt: null }
      }),
      () => ({ body: { enabled: true, pushed: true } })
    )

    screen.getByRole('button', { name: 'Push them now' }).click()

    await waitFor(() => {
      expect(http.calls[0]?.path).toBe('/api/settings/retry-push')
    })
  })

  it('warns that a development URL gives no persistent visitor id', () => {
    show(
      readyStatus({
        selection: { ...(readyStatus().selection as NonNullable<Status['selection']>), usingDevelopmentUrl: true }
      })
    )

    expect(screen.getByText(/no persistent/)).toBeTruthy()
  })
})

describe('changing site and disconnecting', () => {
  it('confirms, then clears the selection', async () => {
    const { onChanged } = show(readyStatus(), () => ({ body: { cleared: true, trackingStopped: true } }))
    screen.getByRole('button', { name: 'Change site' }).click()
    await waitFor(() => {
      expect(hostCalls.modals).toHaveLength(1)
    })
    await hostCalls.confirmLast()

    expect(http.calls[0]).toMatchObject({ path: '/api/settings/change-site', method: 'POST' })
    expect(onChanged).toHaveBeenCalled()
  })

  it('says tracking stops until a new site is chosen', async () => {
    show(readyStatus())
    screen.getByRole('button', { name: 'Change site' }).click()

    await waitFor(() => {
      expect(hostCalls.modals[0]?.content).toContain('Tracking stops until you pick a new site')
    })
  })

  // The Admin labels a `danger` modal's button "Delete", which none of these actions does.
  it.each([
    ['Change site', () => screen.getByRole('button', { name: 'Change site' }).click()],
    ['Disconnect', () => screen.getByRole('button', { name: 'Disconnect' }).click()],
    ['Stop tracking', () => toggle().click()]
  ])('%s asks with a confirm modal, never a danger one', async (_name, open) => {
    show(readyStatus())
    open()

    await waitFor(() => {
      expect(hostCalls.modals).toHaveLength(1)
    })
    expect(hostCalls.modals[0]?.type).toBe('confirm')
  })

  it('confirms before disconnecting, and says what is lost', async () => {
    const { onChanged } = show(readyStatus(), () => ({ body: { disconnected: true } }))
    screen.getByRole('button', { name: 'Disconnect' }).click()
    await waitFor(() => {
      expect(hostCalls.modals).toHaveLength(1)
    })
    expect(hostCalls.modals[0]?.content).toContain('Tracking stops')
    await hostCalls.confirmLast()

    expect(http.calls[0]).toMatchObject({ path: '/api/qinto/disconnect', method: 'POST' })
    expect(onChanged).toHaveBeenCalled()
  })
})

describe('a site whose DNS is not wired up', () => {
  const RECORDS = [
    { type: 'CNAME' as const, name: 'xfbaos', value: 'edge.qinto.tech', note: 'Disable the proxy.' },
    { type: 'TXT' as const, name: '_blotout-challenge.xfbaos', value: 'qv=1;token=9f3a' }
  ]

  const pendingDns = (): Status => {
    const base = readyStatus()
    if (base.selection === null) {
      throw new Error('the ready fixture is meant to have a selection')
    }

    return readyStatus({
      selection: {
        ...base.selection,
        dnsValid: false,
        dnsMessage: 'custom hostname does not CNAME to this zone.',
        dnsRecords: RECORDS
      },
      tracking: { ...base.tracking, live: false }
    })
  }

  it('says the hostname does not resolve, instead of showing a healthy screen', () => {
    // Qinto reports the site as serving the moment it is deployed, so this is the only warning
    // between the merchant and a screen that looks fine while every event dies in the browser.
    show(pendingDns())

    expect(screen.getByText(/are not in place yet/)).toBeTruthy()
    expect(screen.getByText(/does not CNAME to this zone/)).toBeTruthy()
    expect(screen.getByText('Not sending')).toBeTruthy()
  })

  it('shows the records themselves, so the fix does not need another product', () => {
    show(pendingDns())

    expect(screen.getByText('edge.qinto.tech')).toBeTruthy()
    expect(screen.getByText('_blotout-challenge.xfbaos')).toBeTruthy()
    expect(screen.getByText('Disable the proxy.')).toBeTruthy()
  })

  it('emails the records to whoever manages DNS, with an idempotency key', async () => {
    show(pendingDns(), () => ({ body: { sent: 2 } }))

    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: 'dev@example.com, ops@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))

    expect(await screen.findByText('Instructions sent to 2 addresses.')).toBeTruthy()
    expect(http.calls[0]).toMatchObject({
      path: '/api/setup/dns/share',
      method: 'POST',
      body: { teamId: 'team-1', domainId: 'domain-1', emails: ['dev@example.com', 'ops@example.com'] }
    })
    const sent = http.calls[0]?.body as { submissionId?: unknown } | undefined
    expect(typeof sent?.submissionId).toBe('string')
  })

  it('refuses an address that is not one, without asking Qinto', () => {
    show(pendingDns())

    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: 'not-an-address' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))

    expect(screen.getByRole('alert').textContent).toContain('is not a valid email address')
    expect(http.calls).toHaveLength(0)
  })

  it('says nothing was sent when the merchant sends an empty field', () => {
    show(pendingDns())
    fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))

    expect(screen.getByRole('alert').textContent).toContain('Add at least one email address.')
    expect(http.calls).toHaveLength(0)
  })

  it('names Qinto’s own reason when the send is refused', async () => {
    show(pendingDns(), () => ({ status: 502, body: { error: 'qinto_api', code: 'rate_limited' } }))

    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: 'dev@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))

    expect((await screen.findByRole('alert')).textContent).toContain('limiting how often these can be sent')
  })

  it('explains a site that needs no records rather than showing a raw slug', async () => {
    show(pendingDns(), () => ({ status: 502, body: { error: 'qinto_api', code: 'no_dns_records' } }))

    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: 'dev@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))

    expect((await screen.findByRole('alert')).textContent).toContain('nothing to share')
  })

  it('surfaces an unexpected failure in Qinto’s own words', async () => {
    show(pendingDns(), () => ({ status: 502, body: { error: 'qinto_api', code: 'internal', detail: 'the mailer is down' } }))

    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: 'dev@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))

    expect((await screen.findByRole('alert')).textContent).toContain('the mailer is down')
  })

  it('holds the line at ten recipients, the cap Qinto enforces', () => {
    show(pendingDns())

    const eleven = Array.from({ length: 11 }, (_, index) => `dev${index}@example.com`).join(', ')
    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: eleven } })
    fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))

    expect(screen.getByRole('alert').textContent).toContain('up to 10 people at a time')
    expect(http.calls).toHaveLength(0)
  })

  it('counts one recipient as one address', async () => {
    show(pendingDns(), () => ({ body: { sent: 1 } }))

    // Written twice: the duplicate is collapsed here rather than at Qinto, so the count the
    // merchant reads is the number of people who will actually receive it.
    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: 'dev@example.com Dev@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))

    expect(await screen.findByText('Instructions sent to 1 address.')).toBeTruthy()
    expect(http.calls[0]).toMatchObject({ body: { emails: ['dev@example.com'] } })
  })

  it('shows the records with no message of Qinto’s to add', () => {
    const base = readyStatus()
    if (base.selection === null) {
      throw new Error('the ready fixture is meant to have a selection')
    }

    show(
      readyStatus({
        selection: { ...base.selection, dnsValid: false, dnsMessage: null, dnsRecords: RECORDS },
        tracking: { ...base.tracking, live: false }
      })
    )

    expect(screen.getByText('edge.qinto.tech')).toBeTruthy()
    expect(screen.queryByText(/does not CNAME/)).toBeNull()
  })

  it('is absent while DNS is satisfied, because there is nothing to publish', () => {
    show(readyStatus())

    expect(screen.queryByLabelText('Email addresses')).toBeNull()
  })
})

describe('the optional custom-code block', () => {
  it('is advertised here too, not only during onboarding', () => {
    // A merchant who picks an existing Qinto site never enters onboarding, so the deploy step's
    // copy reached nobody on this path and the feature was invisible to them.
    show(readyStatus())

    expect(screen.getByText('Optional: your own tracking code')).toBeTruthy()
    expect(screen.getByText('App embeds')).toBeTruthy()
  })

  it('links to the store’s own theme settings', () => {
    show(readyStatus())

    expect(screen.getByRole('link', { name: 'Online Store' }).getAttribute('href')).toBe(
      'https://srini-test.myshopline.com/admin/website/shopSetting'
    )
  })
})

describe('a saved site whose team was not approved on reconnect', () => {
  const missingTeam = () => {
    const status = readyStatus()
    if (status.selection === null) {
      throw new Error('the ready fixture always has a selection')
    }

    return readyStatus({ selection: { ...status.selection, deliveryLive: false, notVisible: 'team_not_approved' } })
  }

  it('names the site and team, and says the storefront is unchanged', () => {
    show(missingTeam())

    expect(screen.getByText(/is in karri’s Team you didn’t approve/)).toBeTruthy()
    expect(screen.getByText(/Nothing on your storefront has changed/)).toBeTruthy()
  })

  it('sends the merchant to Qinto at the top level to approve it', async () => {
    show(missingTeam(), ({ path }) =>
      path === '/api/qinto/connect' ? { body: { authorizeUrl: 'https://portal.qinto.tech/oauth/authorize?prompt=consent' } } : { body: {} }
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve that team on Qinto' }))

    await waitFor(() => {
      expect(hostCalls.redirects).toEqual(['https://portal.qinto.tech/oauth/authorize?prompt=consent'])
    })
  })

  it('re-enables the button when the connection could not be started', async () => {
    show(missingTeam(), ({ path }) => (path === '/api/qinto/connect' ? { status: 500, body: { error: 'internal' } } : { body: {} }))

    fireEvent.click(screen.getByRole('button', { name: 'Approve that team on Qinto' }))

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.level === 'error')).toBe(true)
    })
    expect((await screen.findByRole('button', { name: 'Approve that team on Qinto' })).hasAttribute('disabled')).toBe(false)
  })

  it('stays quiet when the site is readable', () => {
    show(readyStatus())

    expect(screen.queryByRole('button', { name: 'Approve that team on Qinto' })).toBeNull()
  })
})

type Selection = NonNullable<Status['selection']>

const withSelection = (patch: Partial<Selection>): Status => {
  const status = readyStatus()
  if (status.selection === null) {
    throw new Error('the ready fixture has a selection')
  }

  return { ...status, selection: { ...status.selection, ...patch } }
}

describe('the destination switch', () => {
  const option = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) }) as HTMLInputElement
  it('switches to the Qinto URL and pushes it', async () => {
    const { onChanged } = show(readyStatus(), () => ({ body: { deliveryHost: 'qsrini-shoplinecom-1.dev.qinto.tech', pushed: true } }))

    expect(option('Your own domain').checked).toBe(true)
    fireEvent.click(option('Qinto URL'))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(http.calls.find((call) => call.path === '/api/setup/destination')).toMatchObject({
      method: 'PUT',
      body: { target: 'development_url' }
    })
    expect(hostCalls.toasts.some((toast) => toast.level !== 'error' && toast.message.includes('qsrini-shoplinecom-1'))).toBe(true)
  })

  it('shows a spinner on the option it is switching to until the switch finishes', async () => {
    let finish: () => void = () => undefined
    const onChanged = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    http = stubHttp(() => ({ body: { deliveryHost: 'qsrini-shoplinecom-1.dev.qinto.tech', pushed: true } }))
    render(<ReadyScreen status={readyStatus()} onChanged={onChanged} />)

    fireEvent.click(option('Qinto URL'))

    expect((await screen.findByRole('status')).textContent).toBe('Switching to the Qinto URL…')
    expect(option('Your own domain').disabled).toBe(true)

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    finish()
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('reports a push SHOPLINE refused', async () => {
    show(readyStatus(), () => ({ body: { deliveryHost: 'x', pushed: false, error: 'SHOPLINE said no' } }))

    fireEvent.click(option('Qinto URL'))

    await waitFor(() => expect(hostCalls.toasts.some((toast) => toast.message === 'SHOPLINE said no')).toBe(true))
  })

  it('switches back to the first-party domain', async () => {
    const { onChanged } = show(withSelection({ usingDevelopmentUrl: true, deliveryHost: 'qsrini-shoplinecom-1.dev.qinto.tech' }), () => ({
      body: { deliveryHost: 'q.srini-shopline.com', pushed: true }
    }))

    expect(option('Qinto URL').checked).toBe(true)
    fireEvent.click(option('Your own domain'))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(http.calls.find((call) => call.path === '/api/setup/destination')).toMatchObject({ body: { target: 'domain' } })
  })

  it('does nothing when the active option is clicked again', () => {
    show(readyStatus())

    fireEvent.click(option('Your own domain'))

    expect(http.calls).toHaveLength(0)
  })

  it('is disabled for a site with no Qinto URL', () => {
    show(withSelection({ hosts: { domain: 'q.srini-shopline.com', developmentUrl: null } }))

    expect(option('Qinto URL').disabled).toBe(true)
    expect(screen.getByText('This site has no Qinto URL')).toBeTruthy()
  })

  it('points at the DNS records after moving to a domain that does not resolve yet', () => {
    show(withSelection({ dnsValid: false, dnsRecords: [{ type: 'CNAME', name: 'q', value: 'edge' }] }))

    const scroll = vi.fn()
    const card = document.getElementById('dns-records')
    if (card === null) {
      throw new Error('the DNS card is on screen')
    }
    card.scrollIntoView = scroll
    fireEvent.click(screen.getByRole('button', { name: 'Show the DNS records' }))

    expect(scroll).toHaveBeenCalled()
  })
})

describe('allowed origins', () => {
  it('offers to add a storefront the site does not allow', async () => {
    const status = withSelection({ origins: { state: 'missing', missing: ['https://srini-test.myshopline.com'] } })
    show(status, () => ({ body: { origins: { state: 'allowed', missing: [] } } }))

    expect(screen.getByText('https://srini-test.myshopline.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to allowed origins' }))

    await waitFor(() => expect(http.calls.some((call) => call.path === '/api/setup/origins' && call.method === 'POST')).toBe(true))
    await waitFor(() => expect(hostCalls.toasts.some((toast) => toast.message.includes('allowed origins'))).toBe(true))
  })

  it('says a retry hit a full list', async () => {
    const status = withSelection({ origins: { state: 'missing', missing: ['https://a.example.com'] } })
    show(status, () => ({ body: { origins: { state: 'full', missing: ['https://a.example.com'] } } }))

    fireEvent.click(screen.getByRole('button', { name: 'Add to allowed origins' }))

    await waitFor(() => expect(hostCalls.toasts.some((toast) => toast.message.includes('20 origins'))).toBe(true))
  })

  it('explains a full list without offering a retry', () => {
    show(withSelection({ origins: { state: 'full', missing: ['https://a.example.com'] } }))

    expect(screen.getByText(/already allows 20 origins/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to allowed origins' })).toBeNull()
  })

  it('says nothing when the site does not check origins', () => {
    show(withSelection({ origins: { state: 'check_off', missing: [] } }))

    expect(screen.queryByText(/allowed origins/)).toBeNull()
  })
})
