import { api } from './api'
import { openTopLevel, toast } from './app-bridge'

/**
 * Starts the Qinto authorization, from the connect banner or from a re-approval.
 *
 * Shared because both callers must open the URL the **same** way: Qinto's consent screen sets
 * `frame-ancestors 'none'`, so anything but a top-level redirect shows the merchant a blank box.
 *
 * @returns `true` when the redirect was handed to the host, `false` when it failed and was reported.
 */
export const startBlotoutConnect = async (): Promise<boolean> => {
  try {
    const { authorizeUrl } = await api<{ authorizeUrl: string }>('/api/qinto/connect')
    openTopLevel(authorizeUrl)

    return true
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not start the connection')

    return false
  }
}
