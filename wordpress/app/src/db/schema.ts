import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// SQLite has no date type; millisecond epoch integers match what a JS Date represents.
const timestampMs = (name: string) => integer(name, { mode: 'timestamp_ms' })
const flag = (name: string) => integer(name, { mode: 'boolean' })
const nowFn = () => new Date()

/**
 * One row per WordPress install, minted by `POST /register`.
 *
 * `shop_id` (the site's `home_url`) and `return_url` are pinned here, so the broker can only ever
 * redirect an install back to the URL it registered and every signature binds the stored shop.
 */
export const registrations = sqliteTable(
  'registrations',
  {
    id: text('id').primaryKey(),
    // Per-install HMAC secret; encrypted, see `crypto/secret.ts`.
    siteSecretEnc: text('site_secret_enc').notNull(),
    shopId: text('shop_id').notNull(),
    returnUrl: text('return_url').notNull(),
    verifiedAt: timestampMs('verified_at'),
    createdAt: timestampMs('created_at').notNull().$defaultFn(nowFn),
    // The last signed call; the plugin sends one daily. Null until the first one.
    lastSeenAt: timestampMs('last_seen_at')
  },
  (table) => [index('registrations_created_at').on(table.createdAt)]
)

/** In-flight OAuth: one-time CSRF state, its own PKCE verifier and the WP nonce to echo back. */
export const oauthStates = sqliteTable(
  'oauth_states',
  {
    state: text('state').primaryKey(),
    registrationId: text('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'cascade' }),
    // Encrypted, AAD `oauth_states:<state>:code_verifier`.
    codeVerifier: text('code_verifier').notNull(),
    wpNonce: text('wp_nonce').notNull(),
    createdAt: timestampMs('created_at').notNull().$defaultFn(nowFn)
  },
  (table) => [index('oauth_states_created_at').on(table.createdAt)]
)

/** The Qinto grant, one per registration. Both tokens are AES-GCM ciphertext bound to this row. */
export const qintoConnections = sqliteTable('qinto_connections', {
  registrationId: text('registration_id')
    .primaryKey()
    .references(() => registrations.id, { onDelete: 'cascade' }),
  qintoUserId: text('qinto_user_id'),
  qintoUserEmail: text('qinto_user_email'),
  accessTokenEnc: text('access_token_enc').notNull(),
  accessTokenExpiresAt: timestampMs('access_token_expires_at').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
  scope: text('scope').notNull(),
  connectedAt: timestampMs('connected_at').notNull().$defaultFn(nowFn),
  revokedAt: timestampMs('revoked_at'),
  // Set while one request holds the right to refresh; see `services/connection-store.ts`.
  refreshLeaseUntil: timestampMs('refresh_lease_until')
})

/** The site the install chose, and the host its plugin prints. */
export const siteSelections = sqliteTable('site_selections', {
  registrationId: text('registration_id')
    .primaryKey()
    .references(() => registrations.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull(),
  domainId: text('domain_id').notNull(),
  siteName: text('site_name'),
  deliveryHost: text('delivery_host').notNull(),
  usingDevelopmentUrl: flag('using_development_url').notNull(),
  appInstalledAt: timestampMs('app_installed_at').notNull(),
  selectedAt: timestampMs('selected_at').notNull().$defaultFn(nowFn)
})

/**
 * Replay guard: a signed request's nonce is accepted once inside the signature window.
 * Keyed per install, so one install cannot burn another's nonces.
 */
export const usedNonces = sqliteTable(
  'used_nonces',
  {
    registrationId: text('registration_id').notNull(),
    nonce: text('nonce').notNull(),
    expiresAt: timestampMs('expires_at').notNull()
  },
  (table) => [primaryKey({ columns: [table.registrationId, table.nonce] }), index('used_nonces_expires_at').on(table.expiresAt)]
)
