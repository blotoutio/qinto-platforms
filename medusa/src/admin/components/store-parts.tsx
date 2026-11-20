import { StatusBadge, Switch, Text } from "@medusajs/ui"
import { STATE_COLOR, STATE_LABEL, type Store } from "../lib/stores"

/** Small pieces shared by the single-store card, the table and the drawer. */

export const StoreBadge = ({ store }: { store: Store }) => (
  <StatusBadge color={STATE_COLOR[store.state]}>{STATE_LABEL[store.state]}</StatusBadge>
)

type TrackingSwitchProps = {
  store: Store
  busy: boolean
  onChange: (store: Store, on: boolean) => void
}

/** Disabled until the store can actually send: it needs a publishable key and a first-party domain. */
export const TrackingSwitch = ({ store, busy, onChange }: TrackingSwitchProps) => (
  <Switch
    aria-label={`Tracking for ${store.name}`}
    checked={store.enabled && store.state !== "notset" && store.state !== "nokey"}
    disabled={busy || store.state === "notset" || store.state === "nokey"}
    onCheckedChange={(checked) => onChange(store, checked)}
  />
)

const Check = ({ done, children }: { done: boolean; children: React.ReactNode }) => (
  <li className="flex items-baseline gap-x-2">
    <span
      className={`w-4 shrink-0 text-center ${done ? "text-ui-fg-interactive" : "text-ui-tag-orange-icon"}`}
      aria-hidden="true"
    >
      {done ? "✓" : "!"}
    </span>
    <Text size="small">{children}</Text>
  </li>
)

export const SetupChecklist = ({ store }: { store: Store }) => {
  const hasKey = store.state !== "nokey"
  const hasUrl = Boolean(store.first_party_domain)

  return (
    <ul className="flex flex-col gap-y-1.5">
      <Check done={hasKey}>
        {hasKey ? "Storefront has a publishable key" : "Add a publishable key to this sales channel"}
      </Check>
      <Check done={hasUrl}>{hasUrl ? "First-party domain set" : "First-party domain not set yet"}</Check>
      <Check done={store.state === "sending"}>
        {store.state === "sending" ? "Tracking on" : "Not sending"}
      </Check>
    </ul>
  )
}

/** Shown when a key linked to this store is shared with another store that disagrees. */
export const ConflictNote = ({ store, stores }: { store: Store; stores: Store[] }) => {
  if (!store.conflicts.length) {
    return null
  }

  const nameOf = (id: string) => stores.find((s) => s.sales_channel_id === id)?.name ?? id

  return (
    <div className="bg-ui-tag-orange-bg text-ui-tag-orange-text rounded-md px-3 py-2">
      {store.conflicts.map((c) => (
        <Text key={c.keyTitle} size="small">
          The key “{c.keyTitle}” is also linked to another store. Its storefront sends with{" "}
          {nameOf(c.sendsToSalesChannelId)}&apos;s settings. Link each storefront&apos;s key to one
          sales channel to avoid this.
        </Text>
      ))}
    </div>
  )
}

/**
 * Sales channels no storefront can reach yet, shown under the single-store card and the empty
 * state so a merchant adding a site sees it here straight away. The table lists them as rows.
 */
export const ChannelsWithoutKey = ({ stores }: { stores: Store[] }) => {
  const unreachable = stores.filter((s) => s.state === "nokey")

  if (!unreachable.length) {
    return null
  }

  return (
    <Text size="small" className="text-ui-fg-subtle">
      Not tracked yet: {unreachable.map((s) => s.name).join(", ")}. Link a publishable key to{" "}
      {unreachable.length === 1 ? "this sales channel" : "these sales channels"} in Settings →
      Publishable API Keys to set {unreachable.length === 1 ? "it" : "them"} up here.
    </Text>
  )
}

export const keyLine = (store: Store): string =>
  store.publishable_keys.length
    ? `Key: ${store.publishable_keys.join(", ")}`
    : "No publishable key. Add one to this sales channel to track it."
