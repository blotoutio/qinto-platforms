import type { OnboardingStep } from '../../lib/types'

/** The three steps a new Qinto user walks. Only the middle one happens outside this app. */
export const STEP_LABELS: { step: OnboardingStep; label: string }[] = [
  { step: 'site', label: 'Domain' },
  { step: 'dns', label: 'DNS' },
  { step: 'deploy', label: 'Deploy' }
]

export function Steps({ current }: { current: OnboardingStep }) {
  const currentIndex = STEP_LABELS.findIndex((entry) => entry.step === current)

  return (
    <div className='steps'>
      {STEP_LABELS.map((entry, index) => (
        <div className={`step ${index === currentIndex ? 'step-current' : ''} ${index < currentIndex ? 'step-done' : ''}`} key={entry.step}>
          <span className='step-dot'>{index < currentIndex ? '✓' : index + 1}</span>
          <span>{entry.label}</span>
        </div>
      ))}
    </div>
  )
}
