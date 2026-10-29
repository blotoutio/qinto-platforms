import type { Status } from '../../lib/types'

type Props = {
  connection: Status['connection']
  busy: boolean
  onDisconnect: () => void
}

/** Who authorized the Qinto connection, and what it may do. */
export function AccountCard({ connection, busy, onDisconnect }: Props) {
  return (
    <div className='card'>
      <div className='card-header'>
        <div className='stack'>
          <h2>Qinto account</h2>
          {connection.connected ? (
            <p className='muted'>
              {connection.userEmail ?? 'Connected'} · authorized {new Date(connection.connectedAt).toLocaleDateString()}
            </p>
          ) : (
            <p className='muted'>Not connected.</p>
          )}
        </div>
        {connection.connected ? (
          <button type='button' className='btn-danger' onClick={onDisconnect} disabled={busy}>
            Disconnect
          </button>
        ) : null}
      </div>

      {connection.connected ? (
        <>
          <hr />
          <div className='row'>
            {connection.scopes.map((scope) => (
              <span className='badge badge-off' key={scope}>
                {scope}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
