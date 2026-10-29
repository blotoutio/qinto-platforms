import type { SiteDns } from '../../lib/types'
import { DnsRecordsTable } from '../DnsRecordsTable'
import { ShareDns } from '../ShareDns'

type Props = {
  dns: SiteDns | null
  teamId: string
  domainId: string | null
  host: string
  busy: boolean
  onCheck: () => void
  onReload: () => void
}

/** Step two: the records the merchant publishes at their DNS provider, and whether they are live. */
export function DnsStep({ dns, teamId, domainId, host, busy, onCheck, onReload }: Props) {
  // Qinto refuses to share a site that needs no records, so the form only appears where it works.
  const shareable = domainId !== null && dns?.required === true && !dns.valid && dns.records.length > 0

  return (
    <div className='card'>
      <h2>Publish these DNS records</h2>

      {dns === null ? (
        <div className='row'>
          <div className='spinner' />
          <span className='muted'>Reading the records…</span>
        </div>
      ) : (
        <>
          {dns.required ? null : (
            <div className='notice notice-info'>This site needs no DNS — Qinto attaches the hostname itself. Carry on to deploy.</div>
          )}

          <DnsRecordsTable records={dns.records} />

          {dns.message === '' ? null : <p className='muted'>{dns.message}</p>}
        </>
      )}

      <p className='subtle'>
        Add these at your DNS provider, then check. Propagation is usually minutes but can take hours — you can close this app and come
        back; it remembers where you were.
      </p>

      <div className='row'>
        <button type='button' className='btn-primary' onClick={onCheck} disabled={busy}>
          {busy ? 'Checking…' : 'Check DNS'}
        </button>
        <button type='button' className='btn-secondary' onClick={onReload} disabled={busy}>
          Reload records
        </button>
      </div>

      {shareable ? (
        <>
          <hr />
          <ShareDns teamId={teamId} domainId={domainId} host={host} />
        </>
      ) : null}
    </div>
  )
}
