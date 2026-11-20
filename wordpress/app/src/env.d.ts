/**
 * `wrangler types` only sees `vars`, so the secrets are declared here.
 *
 * Local dev supplies them from `.dev.vars`; deployments from `wrangler secret put`. There is no
 * fallback value for any of them — `readConfig` fails the request instead of guessing.
 */
interface AppSecrets {
  /** Qinto OAuth confidential client, `qc_…`. */
  QINTO_CLIENT_ID: string
  /** Qinto OAuth client secret, `qcs_…`. */
  QINTO_CLIENT_SECRET: string
  /** 32 random bytes, base64. The key every stored secret and token is encrypted under. */
  TOKEN_KEK: string
  /** Test and local only: puts the unhandled error's message in the 500 body. Never set in production. */
  DEBUG_ERRORS?: string
  /** Local development only: the loopback origin to hand Qinto as the OAuth callback. */
  QINTO_DEV_CALLBACK_ORIGIN?: string
}

// `wrangler types` emits `interface Env` and `Cloudflare.Env` separately; both are used.
interface Env extends AppSecrets {}

declare namespace Cloudflare {
  interface Env extends AppSecrets {}
}
