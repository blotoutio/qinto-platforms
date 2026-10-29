import { useState } from 'react'

import { startBlotoutConnect } from '../../lib/connect'
import type { Status } from '../../lib/types'

type Props = {
  selection: NonNullable<Status['selection']>
}

/** The saved site's team was left unticked on reconnect; the storefront is untouched, so this only asks. */
export function TeamNotApproved({ selection }: Props) {
  const [starting, setStarting] = useState(false)

  const reapprove = () => {
    setStarting(true)
    void startBlotoutConnect().then((started) => {
      if (!started) {
        setStarting(false)
      }
    })
  }

  return (
    <div className='notice notice-warn'>
      <div className='stack'>
        <span>
          <strong>
            Your site {selection.siteName ?? selection.deliveryHost} is in {selection.teamName ?? 'a team'} you didn&rsquo;t approve when
            you reconnected.
          </strong>{' '}
          Nothing on your storefront has changed, but this app can&rsquo;t check the site until you approve that team on Qinto.
        </span>
        <div className='row'>
          <button type='button' className='btn-secondary' onClick={reapprove} disabled={starting}>
            {starting ? 'Opening Qinto…' : 'Approve that team on Qinto'}
          </button>
        </div>
      </div>
    </div>
  )
}
