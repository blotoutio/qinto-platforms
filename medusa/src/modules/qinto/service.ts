import { MedusaService } from "@medusajs/framework/utils"
import { QintoConnection } from "./models/qinto-connection"

/**
 * Options a merchant may set in `medusa-config.ts`.
 *
 * Optional, and most stores set none. `qintoUrl` exists so an operator running many stores can bake
 * the destination in rather than pasting it into each admin.
 */
export type QintoPluginOptions = {
  /** Fallback destination, used only when nothing has been set from the admin. */
  qintoUrl?: string
}

/** Where a resolved value came from, so the admin can tell a merchant the truth. */
export type SettingSource = "database" | "config" | "none"

export type QintoSettings = {
  enabled: boolean
  qintoUrl: string | null
  /**
   * A value supplied by plugin options or the environment cannot be removed from the admin —
   * clearing the stored one just falls back to it. Surfacing the source is what stops that being
   * a silent surprise.
   */
  qintoUrlSource: SettingSource
}

const env = (key: string): string | undefined => {
  const value = process.env[key]

  return value === undefined || value === "" ? undefined : value
}

/**
 * Storage and settings resolution for the single Qinto destination.
 *
 * **Precedence is deliberate: database, then plugin options, then environment.** What a merchant
 * set in the admin must win over what a developer once put in a `.env`, otherwise the admin page
 * would show settings that silently do nothing.
 */
class QintoModuleService extends MedusaService({ QintoConnection }) {
  static readonly ID = "qinto_connection_singleton"

  protected readonly options_: QintoPluginOptions

  constructor(container: unknown, options?: QintoPluginOptions) {
    // The generated base constructor takes only the container; plugin options arrive as this
    // subclass's second parameter, which is where they are read from.
    super(container)
    this.options_ = options ?? {}
  }

  get options(): QintoPluginOptions {
    return this.options_
  }

  async getConnection() {
    const [connection] = await this.listQintoConnections({
      id: QintoModuleService.ID,
    })

    return connection ?? null
  }

  /**
   * Creates the row or updates it in place.
   *
   * The create is attempted first and a failure falls through to update, rather than reading and
   * then branching: the id is a fixed primary key, so two concurrent first writes both saw "no
   * row" and both inserted — one of them taking a primary-key violation and surfacing a 500.
   */
  async saveConnection(data: Record<string, unknown>) {
    const existing = await this.getConnection()

    if (existing === null) {
      try {
        const [created] = await this.createQintoConnections([
          { id: QintoModuleService.ID, ...data },
        ])

        return created
      } catch {
        // Lost the race — the row exists now, so fall through and update it.
      }
    }

    const [updated] = await this.updateQintoConnections([
      { id: QintoModuleService.ID, ...data },
    ])

    return updated
  }

  /** Everything the rest of the plugin needs to decide whether and where to send. */
  async getSettings(): Promise<QintoSettings> {
    const connection = await this.getConnection()

    const configQintoUrl = this.options_.qintoUrl ?? env("QINTO_URL") ?? null
    const qintoUrl = connection?.qinto_url ?? configQintoUrl
    const qintoUrlSource: SettingSource =
      connection?.qinto_url != null
        ? "database"
        : configQintoUrl !== null
          ? "config"
          : "none"

    return {
      enabled: connection?.enabled ?? true,
      qintoUrl: qintoUrl === null ? null : qintoUrl.replace(/\/+$/, ""),
      qintoUrlSource,
    }
  }

  /**
   * Sets the destination.
   *
   * Clearing it stops tracking rather than falling silently back to a half-configured state: an
   * empty destination with `enabled: true` would leave the admin claiming it was sending.
   */
  async setQintoUrl(url: string | null) {
    await this.saveConnection({
      qinto_url: url === null || url === "" ? null : url.replace(/\/+$/, ""),
      // Pasting a destination is an explicit opt-in, so it also lifts a previous switch-off.
      ...(url ? { enabled: true } : {}),
    })
  }
}

export default QintoModuleService
