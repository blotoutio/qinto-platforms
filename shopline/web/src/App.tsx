import { useCallback, useEffect, useState } from 'react'

import { ChooseSiteScreen } from './components/ChooseSiteScreen'
import { ConnectScreen } from './components/ConnectScreen'
import { OnboardingScreen } from './components/OnboardingScreen'
import { ReadyScreen } from './components/ReadyScreen'
import { api } from './lib/api'
import { isEmbedded } from './lib/app-bridge'
import type { Status } from './lib/types'

/**
 * The app.
 *
 * Every screen is decided by `/api/status`. There is no client-side router and no local screen
 * state to drift from the server's view — except the one thing the server cannot know: which team
 * the merchant just clicked "create a site" under.
 */
export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [creatingUnderTeam, setCreatingUnderTeam] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const next = await api<Status>('/api/status')
      setStatus(next)
      setFailure(null)
      if (next.screen !== 'onboarding') {
        setCreatingUnderTeam(null)
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not load the app')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!isEmbedded()) {
    return (
      <div className='page'>
        <div className='notice notice-warn'>
          Open this app from your SHOPLINE Admin. It needs a session from the Admin to know which store it is acting for.
        </div>
      </div>
    )
  }

  if (failure !== null) {
    return (
      <div className='page'>
        <div className='notice notice-danger'>{failure}</div>
        <div className='row'>
          <button type='button' className='btn-secondary' onClick={() => void reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (status === null) {
    return (
      <div className='center'>
        <div className='spinner' />
      </div>
    )
  }

  if (status.screen === 'connect') {
    return <ConnectScreen status={status} />
  }

  // A team clicked in the chooser, or a flow already in progress on the server.
  const onboardingTeam = creatingUnderTeam ?? status.onboarding?.teamId ?? null
  if (status.screen === 'onboarding' && onboardingTeam !== null) {
    return <OnboardingScreen status={status} teamId={onboardingTeam} onDone={reload} onCancel={() => setCreatingUnderTeam(null)} />
  }

  if (creatingUnderTeam !== null) {
    return <OnboardingScreen status={status} teamId={creatingUnderTeam} onDone={reload} onCancel={() => setCreatingUnderTeam(null)} />
  }

  if (status.screen === 'ready') {
    return <ReadyScreen status={status} onChanged={reload} />
  }

  return <ChooseSiteScreen status={status} onDone={reload} onCreateSite={setCreatingUnderTeam} />
}
