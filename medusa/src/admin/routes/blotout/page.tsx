import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartBar } from "@medusajs/icons"
import {
  Alert,
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Text,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

/**
 * The merchant-facing setup page: a destination, and a switch.
 *
 * Everything is stored in the database rather than in environment variables, so a store can be
 * configured without a developer and without a redeploy. Both calls go to `/admin/qinto/*` on this
 * same backend, so the admin session authenticates them.
 *
 * There is nothing secret on this page. The Qinto URL is a public delivery host — it is visible in
 * the page source of any site running Qinto — which is why it can be pasted here, served to the
 * storefront over a public route, and printed back to the merchant without a second thought.
 */

type SettingSource = "database" | "config" | "none"

type Status = {
  enabled: boolean
  qinto_url: string | null
  qinto_url_source: SettingSource
  ready: boolean
}

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  })

  const body = (await response.json().catch(() => ({}))) as T & { message?: string }

  if (!response.ok) {
    throw new Error(body.message ?? `Request failed (${response.status})`)
  }

  return body
}

const message = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught)

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-2">
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <div className="text-right">{children}</div>
  </div>
)

const BlotoutPage = () => {
  const [status, setStatus] = useState<Status | null>(null)
  const [qintoUrl, setQintoUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const next = await api<Status>("/admin/qinto")
      setStatus(next)
      setQintoUrl(next.qinto_url ?? "")
    } catch (caught) {
      setError(message(caught))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const run = async (work: () => Promise<void>, done?: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      await work()
      if (done) {
        setNotice(done)
      }
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  // The error has to come before the loading early-return, or a failed first request leaves the
  // page saying "Loading…" forever with the reason sitting in state, unrendered.
  if (status === null) {
    return (
      <Container className="p-6">
        {error ? <Alert variant="error">{error}</Alert> : <Text>Loading…</Text>}
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Blotout — Qinto analytics</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Send storefront events to Qinto.
          </Text>
        </div>
        <Badge color={status.ready ? "green" : "grey"}>
          {status.ready ? "Sending events" : "Not sending"}
        </Badge>
      </div>

      {error ? (
        <div className="px-6 py-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      {notice ? (
        <div className="px-6 py-4">
          <Alert variant="success">{notice}</Alert>
        </div>
      ) : null}

      <div className="px-6 py-4">
        <Label htmlFor="qinto-url" weight="plus">
          Qinto URL
        </Label>
        <Text size="small" className="text-ui-fg-subtle mb-3">
          From your site in the Qinto portal, under <strong>Developer tools</strong>. It looks like{" "}
          <code>https://your-site.qinto.tech</code>.
        </Text>
        {/*
          Stacked, not side by side. The value is a full https URL that a merchant pastes and then
          has to read back to check — sharing the row with a button left it scrolling inside a box
          too narrow to show the host, which is the only part worth checking.
        */}
        <div className="flex max-w-xl flex-col gap-3">
          <Input
            id="qinto-url"
            className="w-full"
            placeholder="https://your-site.qinto.tech"
            value={qintoUrl}
            onChange={(event) => setQintoUrl(event.target.value)}
            disabled={busy}
          />
          {/* `self-start` so the button keeps its own width while the input above stretches. */}
          <Button
            className="self-start"
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("/admin/qinto/settings", {
                  method: "POST",
                  body: JSON.stringify({ qinto_url: qintoUrl.trim() || null }),
                })
                await load()
              }, "Saved.")
            }
          >
            Save
          </Button>
        </div>
        {status.qinto_url_source === "config" ? (
          <Text size="small" className="text-ui-fg-subtle mt-2">
            Currently coming from your server configuration, not from this page. Saving a value here
            overrides it; clearing this field falls back to it.
          </Text>
        ) : null}
      </div>

      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Label weight="plus">Tracking</Label>
          <Text size="small" className="text-ui-fg-subtle">
            Turn off to stop sending without losing the destination above.
          </Text>
        </div>
        <Switch
          checked={status.enabled}
          disabled={busy}
          onCheckedChange={(checked) =>
            void run(async () => {
              await api("/admin/qinto/settings", {
                method: "POST",
                body: JSON.stringify({ enabled: checked }),
              })
              await load()
            }, checked ? "Tracking on." : "Tracking off.")
          }
        />
      </div>

      <div className="px-6 py-4">
        <Row label="Destination">
          <Text size="small">{status.qinto_url ?? "Not set"}</Text>
        </Row>
        <Row label="Tracking">
          <Text size="small">{status.enabled ? "On" : "Off"}</Text>
        </Row>
      </div>

      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Your storefront also needs the Blotout component mounted once in its root layout — see the
          plugin README. Nothing else in your storefront changes.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Blotout",
  icon: ChartBar,
})

export default BlotoutPage
