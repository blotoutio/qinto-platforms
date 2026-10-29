import { useCallback, useEffect, useState } from 'react'

import { ApiError, api } from '../lib/api'
import { toast } from '../lib/app-bridge'
import type { DomainSuggestion, OnboardingStep, Site, SiteDns, Status } from '../lib/types'
import { DeployStep } from './onboarding/DeployStep'
import { DnsStep } from './onboarding/DnsStep'
import { DomainStep } from './onboarding/DomainStep'
import { Steps } from './onboarding/Steps'

type Props = {
  status: Status
  teamId: string
  onDone: () => Promise<void>
  onCancel: () => void
}

/** Only `dns` and `deploy` are resumable; anything else starts the flow at the domain step. */
const resumeAt = (saved: Status['onboarding']): OnboardingStep => {
  return saved?.step === 'dns' || saved?.step === 'deploy' ? saved.step : 'site'
}

const createFailureMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.code === 'already_exists') {
    return 'A Qinto site already serves that hostname. Go back and pick it from the list, or use a different subdomain.'
  }

  return error instanceof Error ? error.message : 'Could not create the site'
}

/**
 * The new-user path: create a site, publish DNS, deploy.
 *
 * The step lives on the server (`onboarding.step`), so a merchant who closes the app during DNS
 * propagation — which can take hours — returns to the DNS step rather than to the beginning.
 */
export function OnboardingScreen({ status, teamId, onDone, onCancel }: Props) {
  const saved = status.onboarding
  const [step, setStep] = useState<OnboardingStep>(resumeAt(saved))
  const [domainId, setDomainId] = useState<string | null>(saved?.domainId ?? null)
  const [rootDomain, setRootDomain] = useState(saved?.rootDomain ?? '')
  const [suggestions, setSuggestions] = useState<DomainSuggestion[]>([])
  const [dns, setDns] = useState<SiteDns | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<{ suggestions: DomainSuggestion[] }>(`/api/qinto/domain-suggestions?teamId=${encodeURIComponent(teamId)}`)
      .then((body) => {
        if (!cancelled) {
          setSuggestions(body.suggestions)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestions([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [teamId])

  const siteQuery = domainId === null ? null : `teamId=${encodeURIComponent(teamId)}&domainId=${encodeURIComponent(domainId)}`

  const loadDns = useCallback(async () => {
    if (siteQuery === null) {
      return
    }

    try {
      setDns(await api<SiteDns>(`/api/setup/dns?${siteQuery}`))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read the DNS records')
    }
  }, [siteQuery])

  useEffect(() => {
    if (step === 'dns') {
      void loadDns()
    }
  }, [step, loadDns])

  /** Runs one step's request with the screen locked. */
  const act = async (run: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await run()
    } finally {
      setBusy(false)
    }
  }

  const createSite = () => {
    const trimmed = rootDomain.trim()
    if (trimmed === '') {
      toast.error('Enter the domain you want to measure from')

      return
    }

    void act(async () => {
      try {
        const { site } = await api<{ site: Site }>('/api/setup/site', { method: 'POST', body: { teamId, rootDomain: trimmed } })
        setDomainId(site.domainId)
        setStep('dns')
      } catch (error) {
        toast.error(createFailureMessage(error))
      }
    })
  }

  const reportCheck = (result: SiteDns): void => {
    if (result.valid || !result.required) {
      setStep('deploy')
      toast.success('DNS verified')

      return
    }

    // `checked: false` means Qinto could not look at all, which is a different problem from "not
    // propagated yet" and needs a different tone.
    if (!result.checked) {
      toast.error(result.message)

      return
    }

    toast.info(result.message === '' ? 'Not verified yet. DNS changes can take a while to propagate.' : result.message)
  }

  const checkDns = () => {
    if (domainId === null) {
      return
    }

    void act(async () => {
      try {
        const result = await api<SiteDns>('/api/setup/dns/check', { method: 'POST', body: { teamId, domainId } })
        setDns(result)
        reportCheck(result)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not check the DNS')
      }
    })
  }

  const deploy = () => {
    if (domainId === null) {
      return
    }

    void act(async () => {
      try {
        const result = await api<{ tracking: { live: boolean; error?: string } }>('/api/setup/deploy', {
          method: 'POST',
          body: { teamId, domainId }
        })
        if (result.tracking.live) {
          toast.success('Deployed. Tracking is on.')
        } else {
          toast.info(result.tracking.error ?? 'Deployed. Tracking starts once the site is serving.')
        }
        await onDone()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not deploy the site')
      }
    })
  }

  return (
    <div className='page'>
      <div className='card'>
        <div className='card-header'>
          <div className='stack'>
            <h1>Set up a Qinto site</h1>
            <p className='muted'>Three steps, and you only do the middle one outside this app.</p>
          </div>
          <button type='button' className='btn-secondary' onClick={onCancel}>
            Back
          </button>
        </div>
        <Steps current={step} />
      </div>

      {step === 'site' ? (
        <DomainStep
          store={status.store}
          suggestions={suggestions}
          rootDomain={rootDomain}
          busy={busy}
          onRootDomainChange={setRootDomain}
          onCreate={createSite}
        />
      ) : null}

      {step === 'dns' ? (
        <DnsStep
          dns={dns}
          teamId={teamId}
          domainId={domainId}
          host={rootDomain}
          busy={busy}
          onCheck={checkDns}
          onReload={() => void loadDns()}
        />
      ) : null}

      {step === 'deploy' ? <DeployStep handle={status.store.handle} busy={busy} onDeploy={deploy} onBack={() => setStep('dns')} /> : null}
    </div>
  )
}
