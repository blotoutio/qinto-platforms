import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Alert, Button, Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { useState } from "react"
import { BlotoutMark } from "../../components/blotout-mark"
import { SingleStoreCard } from "../../components/single-store-card"
import { StoreDrawer } from "../../components/store-drawer"
import { ChannelsWithoutKey } from "../../components/store-parts"
import { StoresTable } from "../../components/stores-table"
import { useStores } from "../../hooks/use-stores"
import { STATE_COLOR, type Store, type StoreState } from "../../lib/stores"

/**
 * The Blotout page: where each storefront sends its events.
 *
 * Every store is configured on its own, by its sales channel. With one storefront (most stores)
 * the page is a single setup card; once a second sales channel has a publishable key it becomes a
 * table, edited in a drawer. There is no store-wide domain and no master switch.
 *
 * Nothing here is secret: a first-party domain is public, visible in the page source of any
 * storefront that loads the collector from it.
 */

const DOCS_URL = "https://docs.blotout.io"

const COUNT_LABEL: Record<StoreState, string> = {
  sending: "sending",
  off: "tracking off",
  notset: "without a domain",
  nokey: "without a publishable key",
}

const Header = ({ stores, showCounts }: { stores: Store[]; showCounts: boolean }) => {
  const counts = stores.reduce<Partial<Record<StoreState, number>>>(
    (acc, s) => ({ ...acc, [s.state]: (acc[s.state] ?? 0) + 1 }),
    {}
  )
  const order: StoreState[] = ["sending", "off", "notset", "nokey"]

  return (
    <Container className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
      <div className="flex items-center gap-x-3">
        <BlotoutMark width={32} height={32} className="text-ui-fg-base shrink-0" />
        <div>
          <Heading level="h1">Blotout Platform</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {showCounts
              ? "Each storefront sends events to its own first-party domain."
              : "Send your storefront's events to the Blotout Platform."}
          </Text>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showCounts
          ? order
              .filter((state) => counts[state])
              .map((state) => (
                <StatusBadge key={state} color={STATE_COLOR[state]}>
                  {counts[state]} {COUNT_LABEL[state]}
                </StatusBadge>
              ))
          : null}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover ml-2"
        >
          Docs ↗
        </a>
      </div>
    </Container>
  )
}

const BlotoutPage = () => {
  const { stores, error, busy, reload, setTracking, setDomain } = useStores()
  const [editingId, setEditingId] = useState<string | null>(null)

  // The error has to come before the loading state, or a failed first request leaves the page
  // saying "Loading" forever with the reason sitting in state, unrendered.
  if (stores === null) {
    return (
      <Container className="mx-auto w-full max-w-[960px] p-6">
        {error ? (
          <div className="flex flex-col items-start gap-y-3">
            <Alert variant="error">{error}</Alert>
            <Button size="small" variant="secondary" onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        ) : (
          <Text>Loading…</Text>
        )}
      </Container>
    )
  }

  const reachable = stores.filter((s) => s.state !== "nokey")
  const single = reachable.length === 1 ? reachable[0] : null
  const editing = stores.find((s) => s.sales_channel_id === editingId) ?? null

  return (
    // A centred reading column: a settings page reads better narrow than stretched edge to edge.
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-y-3">
      <Header stores={stores} showCounts={single === null && reachable.length > 0} />

      {reachable.length === 0 ? (
        <Container className="px-6 py-8">
          <Heading level="h2">No storefront to connect yet</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            A storefront is recognised by its publishable API key. Create one in Settings →
            Publishable API Keys and link it to a sales channel; it will appear here.
          </Text>
          <div className="mt-3">
            <ChannelsWithoutKey stores={stores} />
          </div>
        </Container>
      ) : single ? (
        <SingleStoreCard
          store={single}
          stores={stores}
          busy={busy}
          onSave={setDomain}
          onTracking={(s, on) => void setTracking(s, on)}
        />
      ) : null}
      {single ? <ChannelsWithoutKey stores={stores} /> : null}
      {reachable.length > 1 ? (
        <>
          <StoresTable
            stores={stores}
            busy={busy}
            onEdit={(s) => setEditingId(s.sales_channel_id)}
            onTracking={(s, on) => void setTracking(s, on)}
          />
          <Text size="small" className="text-ui-fg-subtle">
            Switch tracking from the row. Click Edit to change a store&apos;s first-party domain.
          </Text>
          <StoreDrawer
            store={editing}
            stores={stores}
            busy={busy}
            onClose={() => setEditingId(null)}
            onSave={setDomain}
          />
        </>
      ) : null}

      <Text size="small" className="text-ui-fg-subtle">
        Each storefront also needs the Blotout component mounted once in its root layout. See the
        plugin README.
      </Text>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Blotout",
  icon: BlotoutMark,
})

export default BlotoutPage
