import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// SQLite has no date type; millisecond epoch integers match what a JS Date represents.
const timestampMs = (name: string) => integer(name, { mode: 'timestamp_ms' })
const flag = (name: string) => integer(name, { mode: 'boolean' })
const nowFn = () => new Date()

export const ONBOARDING_STEPS = ['connect', 'choose', 'site', 'dns', 'deploy', 'done'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/**
 * Why a settings push failed, in the terms the screen has to reason about.
 *
 * `extension_not_published` is the one that matters: SHOPLINE answers `500 record not found` until
 * the pixel extension has a published version on the store, and no
 * amount of retrying changes that — so a screen must not offer one.
 */
export const PUSH_FAILURE_REASONS = ['extension_not_published', 'forbidden', 'no_selection', 'unknown'] as const
export type PushFailureReason = (typeof PUSH_FAILURE_REASONS)[number]

/**
 * The store's SHOPLINE OAuth grant, one row per handle.
 *
 * The access token is not "offline" in the sense of permanent: the dev store issued one with a
 * 10-hour lifetime. `expires` is when it dies and `refreshAccessToken` is how it comes back.
 */
export const shoplineSessions = sqliteTable(
  'shopline_sessions',
  {
    id: text('id').primaryKey(),
    handle: text('handle').notNull(),
    scope: text('scope'),
    expires: timestampMs('expires'),
    // Encrypted and decrypted inside the session store; see `crypto/secret.ts`.
    accessTokenEnc: text('access_token_enc'),
    updatedAt: timestampMs('updated_at').notNull().$defaultFn(nowFn).$onUpdateFn(nowFn)
  },
  (table) => [index('shopline_sessions_handle').on(table.handle)]
)

/** One row per installed store. */
export const stores = sqliteTable('stores', {
  handle: text('handle').primaryKey(),
  shopId: text('shop_id'),
  shopName: text('shop_name'),
  primaryDomain: text('primary_domain'),
  currency: text('currency'),
  ianaTimezone: text('iana_timezone'),
  installedAt: timestampMs('installed_at').notNull().$defaultFn(nowFn),
  uninstalledAt: timestampMs('uninstalled_at')
})

/** The Blotout grant, one per store. Both tokens are AES-GCM ciphertext, never plaintext. */
export const blotoutConnections = sqliteTable('qinto_connections', {
  handle: text('handle')
    .primaryKey()
    .references(() => stores.handle, { onDelete: 'cascade' }),
  blotoutUserId: text('qinto_user_id'),
  blotoutUserEmail: text('qinto_user_email'),
  appName: text('app_name'),
  accessTokenEnc: text('access_token_enc').notNull(),
  accessTokenExpiresAt: timestampMs('access_token_expires_at').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
  scope: text('scope').notNull(),
  connectedAt: timestampMs('connected_at').notNull().$defaultFn(nowFn),
  revokedAt: timestampMs('revoked_at')
})

/** In-flight OAuth: PKCE verifier + CSRF state. Swept after ten minutes. */
export const blotoutOauthStates = sqliteTable(
  'qinto_oauth_states',
  {
    state: text('state').primaryKey(),
    handle: text('handle').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    createdAt: timestampMs('created_at').notNull().$defaultFn(nowFn)
  },
  (table) => [index('qinto_oauth_states_created_at').on(table.createdAt)]
)

/** The merchant's chosen team and site. */
export const siteSelections = sqliteTable('site_selections', {
  handle: text('handle')
    .primaryKey()
    .references(() => stores.handle, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull(),
  teamName: text('team_name'),
  domainId: text('domain_id').notNull(),
  siteName: text('site_name'),
  deliveryHost: text('delivery_host').notNull(),
  usingDevelopmentUrl: flag('using_development_url').notNull(),
  /** The Qinto user whose grant picked the site; tells "team not approved" from "another account" after a reconnect. */
  qintoUserId: text('qinto_user_id'),
  selectedAt: timestampMs('selected_at').notNull().$defaultFn(nowFn)
})

/**
 * Pixel activation state.
 *
 * `trackingEnabled` is the merchant's intent; `pushedEnabled` is what SHOPLINE last accepted.
 * They are separate so a failed push cannot make the UI claim tracking is off when it is not.
 */
export const pixelState = sqliteTable('pixel_state', {
  handle: text('handle')
    .primaryKey()
    .references(() => stores.handle, { onDelete: 'cascade' }),
  trackingEnabled: flag('tracking_enabled').notNull().default(true),
  pushedEnabled: flag('pushed_enabled'),
  destination: text('destination'),
  settingsPushedAt: timestampMs('settings_pushed_at'),
  lastPushError: text('last_push_error'),
  /**
   * Why the last push failed, as a code the UI can act on.
   *
   * Separate from `last_push_error` because the two answer different questions: the message is for
   * whoever is debugging, the code decides whether the screen may offer a retry at all. Matching on
   * the message to find that out would break the first time SHOPLINE reworded anything.
   */
  lastPushReason: text('last_push_reason', { enum: PUSH_FAILURE_REASONS }),
  disabledAt: timestampMs('disabled_at'),
  // The SHOPLINE staff subject from the session token that flipped the switch.
  disabledBy: text('disabled_by')
})

/** Onboarding progress, so a DNS wait can span sessions. */
export const onboarding = sqliteTable(
  'onboarding',
  {
    handle: text('handle')
      .primaryKey()
      .references(() => stores.handle, { onDelete: 'cascade' }),
    step: text('step', { enum: ONBOARDING_STEPS }).notNull(),
    teamId: text('team_id'),
    domainId: text('domain_id'),
    rootDomain: text('root_domain'),
    subdomain: text('subdomain'),
    updatedAt: timestampMs('updated_at').notNull().$defaultFn(nowFn).$onUpdateFn(nowFn)
  },
  // `text({ enum })` narrows the TypeScript type only; SQLite needs the constraint spelled out.
  (table) => [check('onboarding_step', sql`${table.step} in ('connect','choose','site','dns','deploy','done')`)]
)
