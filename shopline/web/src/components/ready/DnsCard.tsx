import type { Status } from '../../lib/types'
import { DnsRecordsTable } from '../DnsRecordsTable'
import { ShareDns } from '../ShareDns'

type Props = { selection: NonNullable<Status['selection']> }

/**
 * The records still to publish, on the screen a merchant lands on every day.
 *
 * The warning on the tracking card says events cannot arrive; this says what to do about it. Only
 * rendered while `dnsValid` is false, so nothing here has to reason about a verified site.
 */
export function DnsCard({ selection }: Props) {
  return (
    <div className='card'>
      <div className='stack'>
        <h2>
          DNS records for <code>{selection.deliveryHost}</code>
        </h2>
        <p className='muted'>
          Publish these at your DNS provider, then reload this page. Until they are in place that hostname does not resolve and no events
          can reach Qinto.
        </p>
      </div>

      <DnsRecordsTable records={selection.dnsRecords} />

      {selection.dnsMessage === null ? null : <p className='subtle'>{selection.dnsMessage}</p>}

      <hr />

      <ShareDns teamId={selection.teamId} domainId={selection.domainId} host={selection.deliveryHost} />
    </div>
  )
}
