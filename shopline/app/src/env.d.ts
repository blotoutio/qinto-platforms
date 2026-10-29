/**
 * `wrangler types` only sees `vars`, so the secrets are declared here.
 *
 * Local dev supplies them from `.dev.vars`; deployments from `wrangler secret put`. There is no
 * fallback value for any of them — `readConfig` fails the request instead of guessing.
 */
interface AppSecrets {
  /** SHOPLINE app secret. Signs the install callback, the session-token JWT and webhook bodies. */
  SHOPLINE_APP_SECRET: string
  /** Blotout OAuth confidential client, `qc_…`. */
  QINTO_CLIENT_ID: string
  /** Blotout OAuth client secret, `qcs_…`. */
  QINTO_CLIENT_SECRET: string
  /** 32 random bytes, base64. The key every stored token is encrypted under. */
  TOKEN_KEK: string
  /** Test and local only: puts the unhandled error's message in the 500 body. Never set in production. */
  DEBUG_ERRORS?: string
  /**
   * Local development only: the loopback origin to hand Blotout as the OAuth callback.
   *
   * `pnpm dev` sets it to this Worker's own port so tunnel rotation stops invalidating the
   * registered redirect URI. Rejected unless it is loopback, and
   * never set in production.
   */
  QINTO_DEV_CALLBACK_ORIGIN?: string
}

// `wrangler types` emits `interface Env` and `Cloudflare.Env` separately; both are used.
interface Env extends AppSecrets {}

declare namespace Cloudflare {
  interface Env extends AppSecrets {}
}
