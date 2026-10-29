import type { Status } from '../../lib/types'
import { pushFailure } from './push-failure'

type Props = {
  tracking: Status['tracking']
  busy: boolean
  onRetryPush: () => void
}

/**
 * The one thing this UI must never simplify.
 *
 * The merchant asked for one state, SHOPLINE last accepted the other, so the storefront may be
 * doing the opposite of what the toggle shows. Rendering "off" here on the strength of a failed
 * push would be a lie with real consequences, which is why `trackingEnabled` and `pushedEnabled`
 * are separate columns in the first place.
 */
export function PushWarning({ tracking, busy, onRetryPush }: Props) {
  const failure = pushFailure(tracking.lastPushReason)

  return (
    <div className='notice notice-danger'>
      <strong>SHOPLINE has not applied your last change.</strong> You asked for tracking {tracking.enabled ? 'on' : 'off'}, but the last
      settings SHOPLINE accepted say {tracking.pushedEnabled ? 'on' : 'off'}, so your storefront may still be doing the opposite.
      <div style={{ marginTop: 6 }}>{failure.message}</div>
      {failure.retryable || failure.recheckable ? (
        <div className='row' style={{ marginTop: 10 }}>
          <button type='button' className='btn-secondary' onClick={onRetryPush} disabled={busy}>
            {failure.retryable ? 'Retry' : 'Check again'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
