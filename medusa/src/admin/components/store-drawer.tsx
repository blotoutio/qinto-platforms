import { Button, Drawer, Text } from "@medusajs/ui"
import { useState } from "react"
import { hostOf, type Store } from "../lib/stores"
import { DomainField, isUnchanged } from "./domain-field"
import { ConflictNote, SetupChecklist, StoreBadge, keyLine } from "./store-parts"

type Props = {
  store: Store | null
  stores: Store[]
  busy: boolean
  onClose: () => void
  onSave: (store: Store, domain: string) => Promise<boolean>
}

/**
 * Edits one store's first-party domain, with its setup checklist. The switch stays in the table
 * row.
 */
export const StoreDrawer = ({ store, stores, busy, onClose, onSave }: Props) => {
  const [draft, setDraft] = useState("")

  return (
    <Drawer open={store !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <Drawer.Content>
        {store ? (
          <>
            <Drawer.Header>
              <Drawer.Title>Edit {store.name}</Drawer.Title>
              <Drawer.Description>{keyLine(store)}</Drawer.Description>
            </Drawer.Header>
            <Drawer.Body className="flex flex-col gap-y-6">
              <div>
                <Text size="small" weight="plus" className="text-ui-fg-subtle mb-2">
                  Setup
                </Text>
                <SetupChecklist store={store} />
              </div>
              <DomainField
                store={store}
                busy={busy}
                onSave={onSave}
                inline={false}
                onDraftChange={setDraft}
              />
              <ConflictNote store={store} stores={stores} />
              <div className="flex flex-col gap-y-2">
                <Text size="small" weight="plus" className="text-ui-fg-subtle">
                  Status
                </Text>
                <div>
                  <StoreBadge store={store} />
                </div>
                <Text size="small" className="text-ui-fg-subtle">
                  {store.state === "sending"
                    ? `Events from this storefront go to ${hostOf(store.first_party_domain)}.`
                    : "This storefront sends no events."}
                </Text>
              </div>
            </Drawer.Body>
            <Drawer.Footer>
              <Drawer.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Drawer.Close>
              <Button
                variant="primary"
                isLoading={busy}
                disabled={isUnchanged(draft, store)}
                onClick={async () => {
                  if (await onSave(store, draft)) {
                    onClose()
                  }
                }}
              >
                Save
              </Button>
            </Drawer.Footer>
          </>
        ) : null}
      </Drawer.Content>
    </Drawer>
  )
}
