import { openInQinto } from '../../lib/qinto'
import { AppEmbedNote } from '../AppEmbedNote'

type Props = {
  handle: string
  deployUrl: string
  busy: boolean
  onFinish: () => void
  onBack: () => void
}

/** Step three: deploying is Qinto's (it handles billing), so the merchant does it there and comes back. */
export function DeployStep({ handle, deployUrl, busy, onFinish, onBack }: Props) {
  return (
    <>
      <div className='card'>
        <h2>Deploy the site in Qinto</h2>
        <p className='muted'>
          Qinto deploys the site and may ask for a payment method on your team first. Then come back here: this selects the site for this
          store and turns tracking on.
        </p>
        <div className='row'>
          <button type='button' className='btn-secondary' onClick={() => openInQinto(deployUrl)}>
            Deploy in Qinto
          </button>
          <button type='button' className='btn-primary' onClick={onFinish} disabled={busy}>
            {busy ? 'Checking…' : 'I have deployed it'}
          </button>
          <button type='button' className='btn-secondary' onClick={onBack} disabled={busy}>
            Back to DNS
          </button>
        </div>
      </div>

      <AppEmbedNote handle={handle} />
    </>
  )
}
