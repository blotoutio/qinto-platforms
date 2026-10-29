import type { Status } from '../../lib/types'
import { pushFailure } from './push-failure'

type Props = {
  tracking: Status['tracking']
  selection: Status['selection']
  busy: boolean
  onToggle: (enabled: boolean) => void
  onRetryPush: () => void
}

const badge = (tracking: Status['tracking']): { className: string; label: string } => {
  if (tracking.live) {
    return { className: 'badge-live', label: 'Live' }
  }

  return tracking.enabled ? { className: 'badge-warn', label: 'Not sending' } : { className: 'badge-off', label: 'Off' }
}

/** The kill switch, and every reason events might not be arriving. */
export function TrackingCard({ tracking, selection, busy, onToggle, onRetryPush }: Props) {
  const state = badge(tracking)
  const notArriving = tracking.enabled && !tracking.live
  const failure = pushFailure(tracking.lastPushReason)

  return (
    <div className='card'>
      <div className='card-header'>
        <div className='stack'>
          <h1>Tracking</h1>
          <p className='muted'>
            {tracking.live ? 'Storefront events are being sent to Qinto.' : 'Tracking is not sending right now — see the reason below.'}
          </p>
        </div>
        <span className={`badge ${state.className}`}>{state.label}</span>
      </div>

      <hr />

      <div className='spread'>
        <div className='stack' style={{ gap: 2 }}>
          <strong>Send events to Qinto</strong>
          {/* Honest, not reassuring: the sandbox reads its settings once per page load. */}
          <span className='subtle'>Takes effect on each visitor’s next page load. Tabs already open keep sending until they navigate.</span>
        </div>
        <label className='toggle'>
          <input
            type='checkbox'
            checked={tracking.enabled}
            disabled={busy}
            onChange={(event) => onToggle(event.target.checked)}
            aria-label='Send events to Qinto'
          />
          <span className='toggle-track' />
        </label>
      </div>

      {notArriving && selection !== null && !selection.deliveryLive ? (
        <div className='notice notice-warn'>
          Your Qinto site is not serving yet, so nothing can arrive. Deploy it on the Qinto platform, then reload this page.
        </div>
      ) : null}

      {notArriving && selection !== null && selection.dnsValid === false ? (
        <div className='notice notice-warn'>
          <strong>
            The DNS records for <code>{selection.deliveryHost}</code> are not in place yet
          </strong>
          , so that hostname does not resolve and nothing can arrive — Qinto has deployed the site, but your domain does not point at it.
          The records are below.
        </div>
      ) : null}

      {notArriving && tracking.pushedEnabled === null ? (
        <div className='notice notice-warn'>
          <strong>The pixel settings have not reached SHOPLINE yet.</strong> {failure.message}
          {failure.retryable || failure.recheckable ? (
            <div className='row' style={{ marginTop: 10 }}>
              <button type='button' className='btn-secondary' onClick={onRetryPush} disabled={busy}>
                {failure.retryable ? 'Push them now' : 'Check again'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
