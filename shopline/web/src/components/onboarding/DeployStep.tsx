import { AppEmbedNote } from '../AppEmbedNote'

type Props = {
  handle: string
  busy: boolean
  onDeploy: () => void
  onBack: () => void
}

/** Step three: publish to Qinto's edge, which also selects the site and starts tracking. */
export function DeployStep({ handle, busy, onDeploy, onBack }: Props) {
  return (
    <>
      <div className='card'>
        <h2>Deploy the site</h2>
        <p className='muted'>This publishes your site to Qinto's edge and selects it for this store. Tracking turns on when it finishes.</p>
        <div className='row'>
          <button type='button' className='btn-primary' onClick={onDeploy} disabled={busy}>
            {busy ? 'Deploying…' : 'Deploy and start tracking'}
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
