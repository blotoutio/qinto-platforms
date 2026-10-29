import type { DnsRecord } from '../lib/types'

type Props = { records: DnsRecord[] }

/**
 * The records themselves, in the shape a DNS provider's form asks for.
 *
 * Shared by the onboarding step and the ready screen so the two never drift into describing the
 * same records differently. Renders nothing when there are none — a site can be verified, or Qinto
 * can be unable to say, and an empty table would read as "nothing to do" in both cases.
 */
export function DnsRecordsTable({ records }: Props) {
  if (records.length === 0) {
    return null
  }

  return (
    <div className='scroll-x'>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.type}:${record.name}`}>
              <td>{record.type}</td>
              <td>
                <code>{record.name}</code>
              </td>
              <td>
                <code>{record.value}</code>
                {record.note === undefined ? null : <div className='subtle'>{record.note}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
