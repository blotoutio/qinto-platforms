import { useState } from 'react'

import { api } from '../lib/api'
import { confirmDanger, toast } from '../lib/app-bridge'
import type { PushFailureReason, Status } from '../lib/types'
import { AppEmbedNote } from './AppEmbedNote'
import { AccountCard } from './ready/AccountCard'
import { DnsCard } from './ready/DnsCard'
import { PushWarning } from './ready/PushWarning'
import { pushFailure } from './ready/push-failure'
import { SiteCard } from './ready/SiteCard'
import { TeamNotApproved } from './ready/TeamNotApproved'
import { TrackingCard } from './ready/TrackingCard'

type Props = {
  status: Status
  onChanged: () => Promise<void>
}

type PushResponse = { pushed: boolean; error?: string; reason?: PushFailureReason }

/** The same wording the persistent card uses, so a toast never contradicts the screen behind it. */
const refusalMessage = (result: PushResponse): string => pushFailure(result.reason ?? null).message

/**
 * What the merchant sees once a site is chosen.
 *
 * Holds the actions; the cards below it hold the copy. Splitting it that way keeps each screenful
 * readable and keeps every network call in one place.
 */
export function ReadyScreen({ status, onChanged }: Props) {
  const [busy, setBusy] = useState(false)
  const { selection, connection, tracking } = status

  // The merchant asked for one state and SHOPLINE last accepted the other.
  const pushDisagrees = tracking.pushedEnabled !== null && tracking.pushedEnabled !== tracking.enabled

  /** Runs an action with the screen locked, then reloads from `/api/status`. */
  const act = async (run: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await run()
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const setTracking = (enabled: boolean) =>
    act(async () => {
      const result = await api<PushResponse>('/api/settings/tracking', { method: 'PUT', body: { enabled } })
      if (result.pushed) {
        toast.success(
          enabled ? 'Tracking on. It starts on each visitor’s next page load.' : 'Tracking off from each visitor’s next page load.'
        )

        return
      }

      toast.error(refusalMessage(result))
    })

  const onToggle = (next: boolean) => {
    if (next) {
      // Turning tracking on loses nothing, so it needs no confirmation.
      void setTracking(true)

      return
    }

    confirmDanger({
      title: 'Stop tracking for this store?',
      content:
        'No events will be sent to Qinto from your storefront. Your Qinto connection and site selection are kept, so you can turn this back on at any time. It takes effect on each visitor’s next page load.',
      onOk: () => setTracking(false)
    })
  }

  const retryPush = () =>
    void act(async () => {
      const result = await api<PushResponse>('/api/settings/retry-push', { method: 'POST' })
      if (result.pushed) {
        toast.success('SHOPLINE accepted the settings')

        return
      }

      toast.error(refusalMessage(result))
    })

  const changeSite = () =>
    confirmDanger({
      title: 'Choose a different site?',
      content: 'Tracking stops until you pick a new site. Your Qinto connection stays.',
      onOk: () =>
        act(async () => {
          await api('/api/settings/change-site', { method: 'POST' })
        })
    })

  const disconnect = () =>
    confirmDanger({
      title: 'Disconnect from Qinto?',
      content: 'Tracking stops and this store forgets which site it was sending to. You can reconnect at any time.',
      onOk: () =>
        act(async () => {
          await api('/api/qinto/disconnect', { method: 'POST' })
        })
    })

  return (
    <div className='page'>
      {selection?.notVisible === 'team_not_approved' ? <TeamNotApproved selection={selection} /> : null}

      {tracking.enabled ? null : (
        <div className='notice notice-warn'>
          <strong>Tracking is off for this store.</strong> No storefront events are being sent to Qinto. Turn it back on below — no setup to
          redo.
        </div>
      )}

      {pushDisagrees ? <PushWarning tracking={tracking} busy={busy} onRetryPush={retryPush} /> : null}

      <TrackingCard tracking={tracking} selection={selection} busy={busy} onToggle={onToggle} onRetryPush={retryPush} />

      {selection === null || selection.dnsValid !== false ? null : <DnsCard selection={selection} />}

      {selection === null ? null : <SiteCard selection={selection} busy={busy} onChangeSite={changeSite} />}

      <AccountCard connection={connection} busy={busy} onDisconnect={disconnect} />

      <AppEmbedNote handle={status.store.handle} />
    </div>
  )
}
