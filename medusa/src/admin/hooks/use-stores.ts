import { toast, usePrompt } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"
import { fetchStores, hostOf, saveStore, type Store } from "../lib/stores"

const message = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught)

/**
 * Loads the stores and exposes the two actions the page needs.
 *
 * Turning tracking off always goes through a confirmation that names the store and the domain it
 * stops sending to. Turning it on, and saving a domain (which also turns it on), do not ask:
 * neither can lose data.
 */
export const useStores = () => {
  const prompt = usePrompt()
  const [stores, setStores] = useState<Store[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setStores(await fetchStores())
      setError(null)
    } catch (caught) {
      setError(message(caught))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const run = async (work: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true)

    try {
      await work()
      await reload()
      toast.success(done)

      return true
    } catch (caught) {
      toast.error(message(caught))

      return false
    } finally {
      setBusy(false)
    }
  }

  const setTracking = async (store: Store, on: boolean): Promise<void> => {
    if (!on) {
      const confirmed = await prompt({
        title: `Turn off tracking for ${store.name}?`,
        description: `${store.name} will stop sending events to ${hostOf(store.first_party_domain)}. Shoppers on this storefront won't be tracked until you turn it back on. The first-party domain is kept, but events from while tracking is off can't be recovered.`,
        confirmText: "Turn off tracking",
        cancelText: "Cancel",
        variant: "danger",
      })

      if (!confirmed) {
        return
      }
    }

    await run(
      () => saveStore(store.sales_channel_id, { enabled: on }),
      `${store.name}: tracking ${on ? "on" : "off"}.`
    )
  }

  const setDomain = (store: Store, domain: string): Promise<boolean> => {
    const next = domain.trim() || null

    return run(
      () => saveStore(store.sales_channel_id, { first_party_domain: next }),
      !next
        ? `${store.name}: first-party domain removed. This storefront sends no events.`
        : `${store.name}: saved. Tracking is on and events go to ${hostOf(next)}.`
    )
  }

  return { stores, error, busy, reload, setTracking, setDomain }
}
