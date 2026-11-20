/**
 * Once-only rules for memory shared by every tab of one browser (`localStorage`).
 *
 * Per-tab memory let a second tab or a reopened browser send the same Purchase again. Pure, so the
 * rules are tested without a browser; the values come from storage, so every input is untrusted.
 */

/** How many sent keys are kept. Old keys only matter for orders a shopper might reopen. */
export const SENT_CAP = 200

/** `list` with `key` added once, keeping the newest `SENT_CAP`. */
export const remember = (list: unknown, key: string): string[] => {
  const keys = Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : []

  return keys.includes(key) ? keys : [...keys.slice(-(SENT_CAP - 1)), key]
}

/**
 * What a confirmation page view does with the backend's claim. `true`: this view won it, so it
 * sends, even if a losing view of the same order already marked this browser. `false`: another view
 * won. `null`/`undefined`: no claim was made or answered, so this browser's own memory decides.
 */
export const purchaseAction = (first: boolean | null | undefined, marked: boolean): "send" | "skip" =>
  first === true || (first !== false && !marked) ? "send" : "skip"
