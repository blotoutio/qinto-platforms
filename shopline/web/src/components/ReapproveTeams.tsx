import { useState } from 'react'

import { startBlotoutConnect } from '../lib/connect'

/**
 * The way back to Qinto's team list.
 *
 * A Qinto access token carries only the teams ticked on the consent screen, so a merchant who has
 * since been added to a team — or who unticked one — sees a list here that is missing it, with
 * nothing on the screen explaining why. Disconnecting and reconnecting was not an answer either:
 * Qinto used to skip the consent screen and re-issue the same selection, so the list never changed.
 */
export function ReapproveTeams() {
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
    <div className='card'>
      <div className='stack'>
        <h2>Not seeing one of your teams?</h2>
        <p className='muted'>
          Only the teams you ticked when you approved this app appear here — a team you joined afterwards will not, until you approve it.
          Qinto will ask again, with every team you can grant listed.
        </p>
        <div className='row'>
          <button type='button' className='btn-secondary' onClick={reapprove} disabled={starting}>
            {starting ? 'Opening Qinto…' : 'Change which teams'}
          </button>
          <span className='subtle'>Your Qinto account stays connected, and any site already selected is kept.</span>
        </div>
      </div>
    </div>
  )
}
