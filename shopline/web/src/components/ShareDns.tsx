import { useState } from 'react'

import { ApiError, api } from '../lib/api'

type Props = {
  teamId: string
  domainId: string
  /** The hostname the records are for, named so the recipient knows what they are editing. */
  host: string
}

const MAX_RECIPIENTS = 10

/** Splits on commas, spaces and new lines, which is exactly what the field's hint promises. */
export const parseEmails = (value: string): string[] => {
  const entries = value
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '')

  return Array.from(new Set(entries))
}

const localFailure = (emails: string[]): string | null => {
  if (emails.length === 0) {
    return 'Add at least one email address.'
  }

  if (emails.length > MAX_RECIPIENTS) {
    return `You can share with up to ${MAX_RECIPIENTS} people at a time.`
  }

  const invalid = emails.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))

  return invalid === undefined ? null : `“${invalid}” is not a valid email address.`
}

/** Qinto owns every judgement about the send, so its slug is what decides the copy. */
const sendFailure = (error: unknown): string => {
  if (error instanceof ApiError && error.code === 'rate_limited') {
    return 'Qinto is limiting how often these can be sent. Try again in a minute.'
  }

  if (error instanceof ApiError && error.code === 'no_dns_records') {
    return 'This site needs no DNS changes, so there is nothing to share.'
  }

  return error instanceof Error ? error.message : 'Could not send the instructions'
}

/**
 * Hands the DNS records to whoever can actually publish them.
 *
 * The merchant installing the app is often not the person with access to the DNS provider, and
 * without this the records have to be copied out of the Admin by hand. Qinto sends the mail, reading
 * the records again at send time, so the recipient cannot receive a stale value.
 *
 * This is the one widget that calls the backend without going through its screen: the send changes
 * nothing in our own state, so there is no `/api/status` to reload and nothing for the screen to
 * coordinate.
 */
export function ShareDns({ teamId, domainId, host }: Props) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One id per attempt, kept until an attempt succeeds: Qinto dedupes on it for 24 hours, so a
  // retry after a failed or lost response cannot deliver a second copy of the same email.
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID())

  const send = () => {
    const emails = parseEmails(value)
    const invalid = localFailure(emails)
    if (invalid !== null) {
      setSent(null)
      setError(invalid)

      return
    }

    setBusy(true)
    setError(null)
    api<{ sent: number }>('/api/setup/dns/share', { method: 'POST', body: { teamId, domainId, emails, submissionId } })
      .then((result) => {
        setSent(result.sent)
        setValue('')
        setSubmissionId(crypto.randomUUID())
      })
      .catch((failure: unknown) => {
        setSent(null)
        setError(sendFailure(failure))
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className='stack'>
      <div className='stack' style={{ gap: 2 }}>
        <strong>Send these to whoever manages DNS</strong>
        <span className='subtle'>
          They get the records for <code>{host}</code> by email, with the current values. One or more addresses, separated by commas,
          spaces, or new lines.
        </span>
      </div>

      <textarea
        rows={2}
        value={value}
        placeholder='dev@example.com, ops@example.com'
        disabled={busy}
        aria-label='Email addresses'
        onChange={(event) => setValue(event.target.value)}
      />

      <div className='row'>
        <button type='button' className='btn-secondary' onClick={send} disabled={busy}>
          {busy ? 'Sending…' : 'Send instructions'}
        </button>
        {sent === null ? null : (
          <span role='status' className='subtle'>
            Instructions sent to {sent} {sent === 1 ? 'address' : 'addresses'}.
          </span>
        )}
      </div>

      {error === null ? null : (
        <div role='alert' className='notice notice-danger'>
          {error}
        </div>
      )}
    </div>
  )
}
