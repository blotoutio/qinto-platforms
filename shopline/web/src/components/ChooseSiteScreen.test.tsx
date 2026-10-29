import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Site, TeamWithSites } from '../lib/types'
import { chooseStatus, readyStatus } from '../test/fixtures'
import type { HttpStub, Route } from '../test/http'
import { stubHttp } from '../test/http'
import { hostCalls } from '../test/setup'
import { ChooseSiteScreen } from './ChooseSiteScreen'

let http: HttpStub

const SITE: Site = {
  domainId: 'domain-1',
  name: 'srini-shopline.com',
  domain: 'xfbaos.srini-shopline.com',
  rootDomain: 'srini-shopline.com',
  subdomain: 'xfbaos',
  status: 'active',
  developmentUrl: 'dev.qinto.tech',
  deliveryMode: 'development_url',
  deliveryLive: true
}

const TEAM: TeamWithSites = { teamId: 'team-1', name: 'karri’s Team', scopes: ['team:read', 'domain:write'], sites: [SITE] }

const show = (teams: TeamWithSites[] | { status: number }, extra?: Route, status = chooseStatus()) => {
  http = stubHttp((request) => {
    if (request.path === '/api/qinto/teams') {
      return 'status' in teams ? { status: teams.status, body: { error: 'internal' } } : { body: { teams } }
    }

    return extra === undefined ? { body: {} } : extra(request)
  })

  const onDone = vi.fn(() => Promise.resolve())
  const onCreateSite = vi.fn()
  render(<ChooseSiteScreen status={status} onDone={onDone} onCreateSite={onCreateSite} />)

  return { onDone, onCreateSite }
}

beforeEach(() => {
  hostCalls.reset()
})

afterEach(() => {
  cleanup()
  http?.restore()
})

describe('listing', () => {
  it('shows every team with every site under it', async () => {
    show([TEAM, { teamId: 'team-2', name: 'Second Team', scopes: ['team:read'], sites: [] }])

    expect(await screen.findByText('karri’s Team')).toBeTruthy()
    expect(screen.getByText('Second Team')).toBeTruthy()
    expect(screen.getByText('xfbaos.srini-shopline.com')).toBeTruthy()
  })

  it('shows the delivery state of each site', async () => {
    show([TEAM, { ...TEAM, teamId: 'team-3', sites: [{ ...SITE, domainId: 'd2', deliveryLive: false, status: 'pending' }] }])

    expect(await screen.findByText('Serving')).toBeTruthy()
    expect(screen.getByText('Not deployed')).toBeTruthy()
  })

  it('distinguishes a deployed site that has stopped serving', async () => {
    show([{ ...TEAM, sites: [{ ...SITE, deliveryLive: false, status: 'active' }] }])

    expect(await screen.findByText('Not serving yet')).toBeTruthy()
  })

  it('offers to create a site only in a team that can host one', async () => {
    show([TEAM, { teamId: 'team-ro', name: 'Read Only', scopes: ['team:read'], sites: [] }])

    await screen.findByText('Read Only')
    // A button that would 403 is worse than no button; the team says why instead.
    expect(screen.getAllByRole('button', { name: 'Create a site' })).toHaveLength(1)
    expect(screen.getByText('Read-only access')).toBeTruthy()
  })

  it('keeps a team whose sites failed to load, with the reason', async () => {
    show([{ teamId: 'team-x', name: 'Broken', scopes: [], sites: [], error: 'forbidden' }])

    expect(await screen.findByText(/Sites could not be read: forbidden/)).toBeTruthy()
  })

  it('says a team has no sites yet', async () => {
    show([{ ...TEAM, sites: [] }])

    expect(await screen.findByText('No sites in this team yet.')).toBeTruthy()
  })

  it('tells a merchant with no teams what to do', async () => {
    // Not "this account has no teams": an empty list means none was approved, which is a different
    // problem with a different fix, and the app cannot tell the two apart from the grant alone.
    show([])

    expect(await screen.findByText(/did not approve this app for any Qinto team/)).toBeTruthy()
  })

  it('changes the heading copy when there is nothing to pick', async () => {
    show([{ ...TEAM, sites: [] }])

    expect(await screen.findByText(/You have no Qinto sites yet/)).toBeTruthy()
  })

  it('reports a failure to load the list at all', async () => {
    show({ status: 500 })

    expect(await screen.findByText(/internal|failed/i)).toBeTruthy()
  })
})

describe('selecting', () => {
  it('sends the team and site, then reloads', async () => {
    const { onDone } = show([TEAM], () => ({ body: { selected: true, deliveryLive: true, tracking: { live: true } } }))

    ;(await screen.findByRole('button', { name: 'Use this site' })).click()

    await waitFor(() => {
      expect(http.calls.some((call) => call.path === '/api/setup/select')).toBe(true)
    })
    expect(http.calls.at(-1)?.body).toEqual({ teamId: 'team-1', domainId: 'domain-1' })
    expect(onDone).toHaveBeenCalled()
  })

  it('confirms that tracking has started', async () => {
    show([TEAM], () => ({ body: { selected: true, deliveryLive: true, tracking: { live: true } } }))

    ;(await screen.findByRole('button', { name: 'Use this site' })).click()

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message.includes('xfbaos.srini-shopline.com'))).toBe(true)
    })
  })

  it('says why tracking is not live yet rather than claiming success', async () => {
    show([TEAM], () => ({ body: { selected: true, deliveryLive: false, tracking: { live: false, error: 'site is not serving' } } }))

    ;(await screen.findByRole('button', { name: 'Use this site' })).click()

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message === 'site is not serving')).toBe(true)
    })
  })

  it('falls back to a plain explanation when the backend gives no reason', async () => {
    show([TEAM], () => ({ body: { selected: true, deliveryLive: false, tracking: { live: false } } }))

    ;(await screen.findByRole('button', { name: 'Use this site' })).click()

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.message.includes('Tracking starts once the site is serving'))).toBe(true)
    })
  })

  it('reports a rejected selection and re-enables the button', async () => {
    show([TEAM], () => ({ status: 502, body: { error: 'qinto_api', code: 'not_found' } }))

    const button = await screen.findByRole('button', { name: 'Use this site' })
    button.click()

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.level === 'error')).toBe(true)
    })
    expect(await screen.findByRole('button', { name: 'Use this site' })).toBeTruthy()
  })
})

describe('creating', () => {
  it('hands the team back to the shell, which owns the onboarding screen', async () => {
    const { onCreateSite } = show([TEAM])

    ;(await screen.findByRole('button', { name: 'Create a site' })).click()

    expect(onCreateSite).toHaveBeenCalledWith('team-1')
  })
})

describe('a team that is missing from the list', () => {
  it('explains that only approved teams appear, rather than leaving the merchant guessing', async () => {
    // The list is the grant's teams, not the account's. A merchant who joined a team after
    // approving this app sees it missing with nothing on screen accounting for it.
    show([TEAM])

    expect(await screen.findByText('Not seeing one of your teams?')).toBeTruthy()
    expect(screen.getByText(/a team you joined afterwards will not/)).toBeTruthy()
  })

  it('sends the merchant back to Qinto’s team list at the top level', async () => {
    show([TEAM], ({ path }) =>
      path === '/api/qinto/connect' ? { body: { authorizeUrl: 'https://portal.qinto.tech/oauth/authorize?prompt=consent' } } : { body: {} }
    )

    ;(await screen.findByRole('button', { name: 'Change which teams' })).click()

    // Top level, not in the iframe: Qinto's consent screen sets `frame-ancestors 'none'`.
    await waitFor(() => {
      expect(hostCalls.redirects).toEqual(['https://portal.qinto.tech/oauth/authorize?prompt=consent'])
    })
  })

  it('re-enables the button when the connection could not be started', async () => {
    show([TEAM], ({ path }) => (path === '/api/qinto/connect' ? { status: 500, body: { error: 'internal' } } : { body: {} }))

    ;(await screen.findByRole('button', { name: 'Change which teams' })).click()

    await waitFor(() => {
      expect(hostCalls.toasts.some((toast) => toast.level === 'error')).toBe(true)
    })
    expect(await screen.findByRole('button', { name: 'Change which teams' })).toBeTruthy()
    expect(hostCalls.redirects).toEqual([])
  })

  it('offers approval even when no team was approved at all', async () => {
    show([])

    expect(await screen.findByRole('button', { name: 'Change which teams' })).toBeTruthy()
  })
})

describe('a site inherited from another Qinto account', () => {
  const inherited = () => {
    const selection = readyStatus().selection
    if (selection === null) {
      throw new Error('the ready fixture always has a selection')
    }

    return chooseStatus({ selection: { ...selection, deliveryLive: false, notVisible: 'other_account' } })
  }

  it('says the storefront is unchanged and offers both ways forward', async () => {
    show([TEAM], undefined, inherited())

    expect(await screen.findByText(/a site your Qinto account can’t see/)).toBeTruthy()
    expect(screen.getByText(/Nothing on your storefront has changed/)).toBeTruthy()
    expect(screen.getByText(/reconnect with the Qinto account that set it up/)).toBeTruthy()
  })

  it('says nothing of the kind for a store with no site yet', async () => {
    show([TEAM])

    await screen.findByText('Choose a site')
    expect(screen.queryByText(/a site your Qinto account can’t see/)).toBeNull()
  })
})
