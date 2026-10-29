import { useEffect, useState } from 'react'

import { ApiError, api } from '../lib/api'
import { toast } from '../lib/app-bridge'
import type { Site, Status, TeamWithSites } from '../lib/types'
import { ReapproveTeams } from './ReapproveTeams'

type Props = {
  status: Status
  onDone: () => Promise<void>
  onCreateSite: (teamId: string) => void
}

const CREATE_SCOPE = 'domain:write'

const siteBadge = (site: Site) => {
  if (site.deliveryLive) {
    return <span className='badge badge-live'>Serving</span>
  }

  return <span className='badge badge-warn'>{site.status === 'pending' ? 'Not deployed' : 'Not serving yet'}</span>
}

/**
 * Every team, with every site under it.
 *
 * Teams are always listed, even with no sites and even when their sites failed to load, because the
 * merchant needs to see which team they are creating a site under. A team without `domain:write`
 * shows why it cannot host a new site rather than offering a button that would 403.
 */
export function ChooseSiteScreen({ status, onDone, onCreateSite }: Props) {
  const [teams, setTeams] = useState<TeamWithSites[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [selecting, setSelecting] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api<{ teams: TeamWithSites[] }>('/api/qinto/teams')
      .then((body) => {
        if (!cancelled) {
          setTeams(body.teams)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailure(error instanceof Error ? error.message : 'Could not load your Qinto teams')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const select = async (teamId: string, site: Site) => {
    setSelecting(site.domainId)
    try {
      const result = await api<{ deliveryLive: boolean; tracking: { live: boolean; error?: string } }>('/api/setup/select', {
        method: 'POST',
        body: { teamId, domainId: site.domainId }
      })
      if (result.tracking.live) {
        toast.success(`Tracking ${site.domain}`)
      } else {
        toast.info(result.tracking.error ?? 'Site selected. Tracking starts once the site is serving.')
      }
      await onDone()
    } catch (error) {
      setSelecting(null)
      toast.error(error instanceof ApiError ? error.message : 'Could not select that site')
    }
  }

  if (failure !== null) {
    return (
      <div className='page'>
        <div className='notice notice-danger'>{failure}</div>
      </div>
    )
  }

  if (teams === null) {
    return (
      <div className='center'>
        <div className='stack' style={{ alignItems: 'center' }}>
          <div className='spinner' />
          <span className='muted'>Loading your Qinto teams…</span>
        </div>
      </div>
    )
  }

  const anySites = teams.some((team) => team.sites.length > 0)
  const inherited = status.selection?.notVisible === 'other_account' ? status.selection : null

  return (
    <div className='page'>
      {inherited === null ? null : (
        <div className='notice notice-warn'>
          <strong>
            This store is set up to send to {inherited.siteName ?? inherited.deliveryHost}, a site your Qinto account can&rsquo;t see.
          </strong>{' '}
          It was chosen by another Qinto account. Nothing on your storefront has changed: it keeps those settings until you pick one of your
          own sites below. To keep that site instead, reconnect with the Qinto account that set it up.
        </div>
      )}

      <div className='card'>
        <div className='card-header'>
          <div className='stack'>
            <h1>Choose a site</h1>
            <p className='muted'>
              {anySites
                ? 'Pick the Qinto site this store should send events to. Tracking turns on as soon as you choose.'
                : 'You have no Qinto sites yet. Create one and this app will walk you through DNS and deployment.'}
            </p>
          </div>
        </div>
      </div>

      {teams.length === 0 ? (
        <div className='notice notice-warn'>
          You did not approve this app for any Qinto team. Approve one below, or create a team on the Qinto platform first.
        </div>
      ) : null}

      {teams.map((team) => {
        const canCreate = team.scopes.includes(CREATE_SCOPE)

        return (
          <div className='team' key={team.teamId}>
            <div className='team-name'>
              <span>{team.name ?? 'Unnamed team'}</span>
              {canCreate ? (
                <button type='button' className='btn-link' onClick={() => onCreateSite(team.teamId)}>
                  Create a site
                </button>
              ) : (
                <span className='subtle'>Read-only access</span>
              )}
            </div>

            {team.error !== undefined ? <div className='empty'>Sites could not be read: {team.error}</div> : null}

            {team.sites.map((site) => (
              <div className='site' key={site.domainId}>
                <div className='stack' style={{ gap: 2 }}>
                  <span className='site-host'>{site.domain}</span>
                  <span className='subtle'>
                    {site.name !== null && site.name !== site.domain ? `${site.name} · ` : ''}
                    {site.deliveryMode === 'development_url' ? 'Serving from the Qinto development URL' : 'Serving from its own domain'}
                  </span>
                </div>
                <div className='row'>
                  {siteBadge(site)}
                  <button
                    type='button'
                    className='btn-primary'
                    onClick={() => void select(team.teamId, site)}
                    disabled={selecting !== null}
                  >
                    {selecting === site.domainId ? 'Selecting…' : 'Use this site'}
                  </button>
                </div>
              </div>
            ))}

            {team.sites.length === 0 && team.error === undefined ? <div className='empty'>No sites in this team yet.</div> : null}
          </div>
        )
      })}

      <ReapproveTeams />

      {status.selection !== null ? (
        <p className='subtle'>Currently selected: {status.selection.deliveryHost}. Choosing another site replaces it.</p>
      ) : null}
    </div>
  )
}
