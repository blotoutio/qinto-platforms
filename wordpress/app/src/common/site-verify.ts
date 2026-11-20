import { hmacSha256Hex, randomHex, timingSafeEqual } from '../crypto/hmac'

const SITE_VERIFY_TIMEOUT_MS = 5000

/** Must match the plugin's `SiteVerifier`. The prefix keeps it from ever signing a `v1\n` request message. */
export const verifyMessage = (challenge: string): string => `blotout-verify|${challenge}`

/**
 * Calls the site's `admin-post.php?action=blotout_verify&challenge=…` with a fresh challenge and
 * expects `HMAC(secret, verifyMessage(challenge))`. Any failure, including a timeout, is false.
 */
export const verifySiteOwnership = async (returnUrl: string, secret: string): Promise<boolean> => {
  const challenge = randomHex(16)
  const url = new URL(returnUrl)
  url.search = new URLSearchParams({ action: 'blotout_verify', challenge }).toString()

  try {
    const response = await fetch(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(SITE_VERIFY_TIMEOUT_MS) })
    if (!response.ok) {
      return false
    }

    const body = (await response.text()).trim()
    const expected = await hmacSha256Hex(secret, verifyMessage(challenge))

    return timingSafeEqual(body, expected)
  } catch {
    return false
  }
}
