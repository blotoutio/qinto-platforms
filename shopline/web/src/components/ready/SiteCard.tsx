import type { Status } from '../../lib/types'

type Props = {
  selection: NonNullable<Status['selection']>
  busy: boolean
  onChangeSite: () => void
}

/** The chosen site, and where its events actually go. */
export function SiteCard({ selection, busy, onChangeSite }: Props) {
  return (
    <div className='card'>
      <div className='card-header'>
        <div className='stack'>
          <h2>Connected site</h2>
          <p className='muted'>Where this store's events are sent.</p>
        </div>
        <button type='button' className='btn-secondary' onClick={onChangeSite} disabled={busy}>
          Change site
        </button>
      </div>

      <hr />

      <div className='stack'>
        <div className='spread'>
          <span className='muted'>Site</span>
          <strong>{selection.siteName ?? selection.deliveryHost}</strong>
        </div>
        <div className='spread'>
          <span className='muted'>Team</span>
          <span>{selection.teamName ?? 'Your Qinto team'}</span>
        </div>
        <div className='spread'>
          <span className='muted'>Events go to</span>
          <code>{selection.deliveryHost}</code>
        </div>
      </div>

      {selection.usingDevelopmentUrl ? (
        <div className='notice notice-warn'>
          This site is served from Qinto's development URL, which is a different site to your storefront. Visitors get no persistent
          first-party id, so returning visitors look new. Point the site at your own domain before you rely on the data.
        </div>
      ) : null}
    </div>
  )
}
