import { Container, Heading, Text } from "@medusajs/ui"
import { hostOf, type Store } from "../lib/stores"
import { DomainField } from "./domain-field"
import { ConflictNote, SetupChecklist, StoreBadge, TrackingSwitch, keyLine } from "./store-parts"

type Props = {
  store: Store
  stores: Store[]
  busy: boolean
  onSave: (store: Store, domain: string) => Promise<boolean>
  onTracking: (store: Store, on: boolean) => void
}

/**
 * The page for the common case: one storefront. No table and no drawer, just the setup on one
 * card, with the steps up front until the store is connected.
 */
export const SingleStoreCard = ({ store, stores, busy, onSave, onTracking }: Props) => {
  const connected = Boolean(store.first_party_domain)

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between gap-x-4 px-6 py-4">
          <div>
            <Heading level="h2">Your storefront</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {store.name} · {keyLine(store)}
            </Text>
          </div>
          <StoreBadge store={store} />
        </div>

        <div className="flex flex-col gap-y-4 px-6 py-4">
          {connected ? null : (
            <div className="flex flex-col gap-y-1">
              <Text size="small" weight="plus" className="text-ui-fg-subtle">
                Connect in three steps
              </Text>
              <ol className="text-ui-fg-subtle list-decimal pl-5 text-sm">
                <li>Open your site in the Blotout Platform.</li>
                <li>Copy its first-party domain.</li>
                <li>Paste it below and save.</li>
              </ol>
            </div>
          )}
          <DomainField store={store} busy={busy} onSave={onSave} />
          <ConflictNote store={store} stores={stores} />
        </div>

        <div className="flex items-center justify-between gap-x-4 px-6 py-4">
          <div>
            <Text weight="plus">Tracking</Text>
            <Text size="small" className="text-ui-fg-subtle">
              {connected
                ? store.enabled
                  ? `Events go to ${hostOf(store.first_party_domain)}. Turn off to stop sending; the domain is kept.`
                  : "Off. Turn on to start sending again."
                : "Available once a first-party domain is saved."}
            </Text>
          </div>
          <TrackingSwitch store={store} busy={busy} onChange={onTracking} />
        </div>

        <div className="px-6 py-4">
          <Text size="small" weight="plus" className="text-ui-fg-subtle mb-2">
            Setup
          </Text>
          <SetupChecklist store={store} />
        </div>
      </Container>
      <Text size="small" className="text-ui-fg-subtle">
        Running more than one storefront? Give each its own sales channel and publishable key in
        Medusa. They&apos;ll appear here as a list, each with its own first-party domain.
      </Text>
    </>
  )
}
