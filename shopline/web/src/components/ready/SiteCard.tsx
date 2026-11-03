import type { Status } from '../../lib/types'
import { DNS_CARD_ID } from './DnsCard'

type Props = {
  selection: NonNullable<Status['selection']>
  busy: boolean
  onChangeSite: () => void
  onUseQintoUrl: (useQintoUrl: boolean) => void
  /** The option a switch is under way to, or `null` when none is. */
  switchingToQintoUrl: boolean | null
  onRetryOrigins: () => void
}

const showDnsRecords = () => {
  document.getElementById(DNS_CARD_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

type ChoiceProps = {
  title: string
  reason: string
  host: string
  active: boolean
  pending: boolean
  disabled: boolean
  locked: boolean
  onPick: () => void
}

function Choice({ title, reason, host, active, pending, disabled, locked, onPick }: ChoiceProps) {
  const classes = [
    'choice-row',
    active ? 'choice-row-active' : '',
    pending ? 'choice-row-pending' : '',
    disabled ? 'choice-row-disabled' : ''
  ]

  return (
    <label className={classes.filter((name) => name !== '').join(' ')}>
      <input type='radio' name='destination' checked={active} disabled={disabled || locked} onChange={onPick} />
      {pending ? <span className='spinner spinner-sm choice-spinner' aria-hidden='true' /> : null}
      <span className='stack' style={{ gap: 2 }}>
        <strong>
          {title} <span className='subtle'>— {reason}</span>
        </strong>
        <code className='choice-host'>{host}</code>
      </span>
    </label>
  )
}

function DestinationSwitch({
  selection,
  busy,
  onUseQintoUrl,
  switchingToQintoUrl
}: Pick<Props, 'selection' | 'busy' | 'onUseQintoUrl' | 'switchingToQintoUrl'>) {
  const qintoUrl = selection.hosts?.developmentUrl ?? null
  const domain = selection.hosts?.domain ?? selection.deliveryHost
  const usingQintoUrl = selection.usingDevelopmentUrl

  return (
    <fieldset className='stack' style={{ gap: 8, border: 0, margin: 0, padding: 0 }}>
      <legend style={{ padding: 0, marginBottom: 8 }}>
        <strong>Send events to</strong>
      </legend>
      <Choice
        title='Qinto URL'
        reason='works right away, no DNS needed'
        host={qintoUrl ?? 'This site has no Qinto URL'}
        active={usingQintoUrl}
        pending={switchingToQintoUrl === true}
        disabled={qintoUrl === null}
        locked={busy}
        onPick={() => onUseQintoUrl(true)}
      />
      <Choice
        title='Your own domain'
        reason='first-party, needs its DNS records in place'
        host={domain}
        active={!usingQintoUrl}
        pending={switchingToQintoUrl === false}
        disabled={false}
        locked={busy}
        onPick={() => onUseQintoUrl(false)}
      />
      {switchingToQintoUrl === null ? (
        <span className='subtle'>Takes effect on each visitor’s next page load.</span>
      ) : (
        <span className='muted' role='status'>
          Switching to {switchingToQintoUrl ? 'the Qinto URL' : 'your own domain'}…
        </span>
      )}
    </fieldset>
  )
}

function OriginsNotice({ selection, busy, onRetryOrigins }: Pick<Props, 'selection' | 'busy' | 'onRetryOrigins'>) {
  const origins = selection.origins
  if (origins === null || (origins.state !== 'missing' && origins.state !== 'full')) {
    return null
  }

  const list = origins.missing.join(', ')

  if (origins.state === 'full') {
    return (
      <div className='notice notice-warn'>
        Your Qinto site already allows 20 origins, the most it can hold, so <code>{list}</code> could not be added and your storefront
        cannot send events. Remove one under Settings → Privacy & security → Allowed origins in Qinto, then reload this page.
      </div>
    )
  }

  return (
    <div className='notice notice-warn'>
      <div className='stack'>
        <span>
          Your storefront is not in this site’s allowed origins yet (<code>{list}</code>), so Qinto refuses its events.
        </span>
        <div className='row'>
          <button type='button' className='btn-secondary' onClick={onRetryOrigins} disabled={busy}>
            Add to allowed origins
          </button>
        </div>
      </div>
    </div>
  )
}

/** The chosen site, and where its events actually go. */
export function SiteCard({ selection, busy, onChangeSite, onUseQintoUrl, switchingToQintoUrl, onRetryOrigins }: Props) {
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

      <hr />

      <DestinationSwitch selection={selection} busy={busy} onUseQintoUrl={onUseQintoUrl} switchingToQintoUrl={switchingToQintoUrl} />

      {selection.usingDevelopmentUrl ? (
        <div className='notice notice-warn'>
          This site is served from Qinto's development URL, which is a different site to your storefront. Visitors get no persistent
          first-party id, so returning visitors look new. Point the site at your own domain before you rely on the data.
        </div>
      ) : null}

      {!selection.usingDevelopmentUrl && selection.dnsValid === false ? (
        <div className='notice notice-warn'>
          <div className='stack'>
            <span>
              Events now go to <code>{selection.deliveryHost}</code>, but that hostname does not resolve until its DNS records are
              published, so nothing arrives until you add them at your DNS provider.
            </span>
            <div className='row'>
              <button type='button' className='btn-secondary' onClick={showDnsRecords}>
                Show the DNS records
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <OriginsNotice selection={selection} busy={busy} onRetryOrigins={onRetryOrigins} />
    </div>
  )
}
