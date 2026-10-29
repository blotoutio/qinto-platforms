import { useState } from 'react'

import { startBlotoutConnect } from '../lib/connect'
import type { Status } from '../lib/types'

type Props = {
  status: Status
}

/**
 * The whole first screen when the store has no Qinto grant.
 *
 * Nothing else is offered: there is no setting worth showing, and no site to pick, until a Qinto
 * user has authorized us.
 */
export function ConnectScreen({ status }: Props) {
  const [starting, setStarting] = useState(false)
  const revoked = !status.connection.connected && status.connection.reason === 'revoked'

  const connect = () => {
    setStarting(true)
    void startBlotoutConnect().then((started) => {
      if (!started) {
        setStarting(false)
      }
    })
  }

  return (
    <div className='page'>
      {revoked ? (
        <div className='notice notice-warn'>
          <strong>Your Qinto connection is no longer valid</strong> — it was revoked, or the authorization expired. Nothing on your
          storefront has changed: if tracking was on, it is still sending to the same site. Reconnect with the same Qinto account to manage
          it again — your site will still be selected.
        </div>
      ) : null}

      <div className='banner'>
        <div className='mark' aria-hidden='true'>
          B
        </div>
        <h1>Connect Blotout to Qinto</h1>
        <p>
          Qinto measures your storefront from your own domain, so the visitor identity behind your events survives the browser restrictions
          that break third-party pixels. Connect your Qinto account to choose which site this store sends to.
        </p>
        <button type='button' className='btn-primary' onClick={connect} disabled={starting}>
          {starting ? 'Opening Qinto…' : 'Connect with Qinto'}
        </button>
        <p className='subtle'>You will approve the connection on Qinto, then land back here.</p>
      </div>

      <div className='card'>
        <h2>What happens after you connect</h2>
        <ol className='stack muted' style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Pick the Qinto team and site this store should send events to — or create one, right here.</li>
          <li>Tracking turns on straight away. No theme edits, no code to paste.</li>
          <li>
            Page views, product views, cart changes, checkout steps and purchases start arriving at your site as Qinto standard events.
          </li>
        </ol>
      </div>
    </div>
  )
}
