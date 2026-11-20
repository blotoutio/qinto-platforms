import { Button, Container, Table, Text } from "@medusajs/ui"
import { hostOf, type Store } from "../lib/stores"
import { StoreBadge, TrackingSwitch } from "./store-parts"

type Props = {
  stores: Store[]
  busy: boolean
  onEdit: (store: Store) => void
  onTracking: (store: Store, on: boolean) => void
}

/** Several storefronts: one row each, switched from the row, edited in the drawer. */
export const StoresTable = ({ stores, busy, onEdit, onTracking }: Props) => (
  <Container className="overflow-x-auto p-0">
    <Table>
      <Table.Header>
        <Table.Row>
          <Table.HeaderCell>Store</Table.HeaderCell>
          <Table.HeaderCell>First-party domain</Table.HeaderCell>
          <Table.HeaderCell>Status</Table.HeaderCell>
          <Table.HeaderCell>Tracking</Table.HeaderCell>
          <Table.HeaderCell />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {stores.map((store) => {
          const reachable = store.state !== "nokey"

          return (
            <Table.Row key={store.sales_channel_id} className={reachable ? "" : "opacity-60"}>
              <Table.Cell>
                <Text size="small" weight="plus">
                  {store.name}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {reachable ? store.publishable_keys.join(", ") : "No publishable key"}
                </Text>
              </Table.Cell>
              <Table.Cell>
                {store.first_party_domain ? (
                  <Text
                    size="small"
                    className="block max-w-[300px] truncate font-mono"
                    title={store.first_party_domain}
                  >
                    {hostOf(store.first_party_domain)}
                  </Text>
                ) : (
                  <Text size="small" className="text-ui-fg-muted">
                    Not set
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell>
                <div className="flex items-center gap-x-2">
                  <StoreBadge store={store} />
                  {store.conflicts.length ? (
                    <Text size="xsmall" className="text-ui-tag-orange-text" title="Shared publishable key">
                      Shared key
                    </Text>
                  ) : null}
                </div>
              </Table.Cell>
              <Table.Cell>
                <TrackingSwitch store={store} busy={busy} onChange={onTracking} />
              </Table.Cell>
              <Table.Cell className="text-right">
                <Button
                  size="small"
                  variant="secondary"
                  disabled={!reachable}
                  onClick={() => onEdit(store)}
                >
                  Edit
                </Button>
              </Table.Cell>
            </Table.Row>
          )
        })}
      </Table.Body>
    </Table>
  </Container>
)
