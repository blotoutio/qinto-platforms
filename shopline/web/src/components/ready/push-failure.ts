import type { PushFailureReason } from '../../lib/types'

export type PushFailure = {
  /** What the merchant is told. */
  message: string
  /** Whether pressing the card's own action again could plausibly change the outcome. */
  retryable: boolean
  /**
   * Whether the cause is outside this screen and may already have been fixed elsewhere.
   *
   * Distinct from `retryable`: retrying cannot *cause* a publish, but once someone has published,
   * asking SHOPLINE again is the only thing that clears this card. Without it the message is both
   * unactionable and permanent — it survives the fix that resolved it, because nothing else in the
   * app re-pushes.
   */
  recheckable: boolean
}

/**
 * How a failed settings push is presented.
 *
 * Keyed on the reason rather than the message because the decisions differ per reason: `forbidden`
 * and a transient fault are worth retrying as-is, while `extension_not_published` cannot be retried
 * into success — SHOPLINE has nothing on the store to apply settings to until the app has a
 * **published version**. Offering a plain retry there is how
 * someone ends up pressing the same button all afternoon against a wall; offering *nothing* is how
 * the card outlives the problem.
 */
export const pushFailure = (reason: PushFailureReason | null): PushFailure => {
  switch (reason) {
    case 'extension_not_published': {
      return {
        message:
          'SHOPLINE has no pixel on your store for this app yet, so there are no settings for it to apply. That is fixed by publishing the app, not from here — once it has been, check again and this clears.',
        retryable: false,
        recheckable: true
      }
    }
    case 'forbidden': {
      return {
        message:
          'SHOPLINE refused the change as unauthorized. Reopening this app from your Admin refreshes its access, which usually fixes it.',
        retryable: true,
        recheckable: false
      }
    }
    case 'no_selection': {
      return {
        message: 'No Qinto site is selected, so there is nothing to point the storefront at.',
        retryable: false,
        recheckable: false
      }
    }
    default: {
      return { message: 'SHOPLINE did not accept the settings.', retryable: true, recheckable: false }
    }
  }
}
