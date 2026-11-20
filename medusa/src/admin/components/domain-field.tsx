import { Button, Input, Label, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { hostOf, type Store } from "../lib/stores"

type Props = {
  store: Store
  busy: boolean
  onSave: (store: Store, domain: string) => Promise<boolean>
  /** Inline puts Save beside the field; the drawer supplies its own footer button instead. */
  inline?: boolean
  /** Lets a parent (the drawer footer) read the draft value. */
  onDraftChange?: (value: string) => void
}

/** Whether the typed value is the one already saved, so Save has nothing to do. */
export const isUnchanged = (draft: string, store: Store): boolean =>
  draft.trim().toLowerCase() === hostOf(store.first_party_domain)

/**
 * The store's first-party domain, shown and typed as a bare host (`data.yourstore.com`) the way
 * the Blotout Platform shows it. The backend stores it as an https origin.
 */
export const DomainField = ({ store, busy, onSave, inline = true, onDraftChange }: Props) => {
  const saved = hostOf(store.first_party_domain)
  const [draft, setDraft] = useState(saved)
  const id = `first-party-domain-${store.sales_channel_id}`

  useEffect(() => {
    setDraft(saved)
    onDraftChange?.(saved)
    // Reset only when the saved value or the store changes, not on every parent render.
  }, [store.sales_channel_id, saved])

  const update = (value: string) => {
    setDraft(value)
    onDraftChange?.(value)
  }

  return (
    <div className="flex flex-col gap-y-2">
      <Label htmlFor={id} weight="plus">
        First-party domain
      </Label>
      <div className="flex gap-x-2">
        {/* Input renders its own wrapper, so the width has to be set on a container around it. */}
        <div className="min-w-0 flex-1">
          <Input
            id={id}
            className="w-full font-mono"
            placeholder="data.yourstore.com"
            value={draft}
            disabled={busy || store.state === "nokey"}
            onChange={(event) => update(event.target.value)}
          />
        </div>
        {inline ? (
          <Button
            variant="primary"
            disabled={busy || store.state === "nokey" || isUnchanged(draft, store)}
            onClick={() => void onSave(store, draft)}
          >
            Save
          </Button>
        ) : null}
      </div>
      <Text size="small" className="text-ui-fg-subtle">
        In the Blotout Platform, open this store&apos;s site and copy its first-party domain. Saving
        a domain turns tracking on for this store.
      </Text>
    </div>
  )
}
