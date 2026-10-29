/**
 * The origin the outside world reaches this app on.
 *
 * Read from the request rather than from configuration: the app is served on a rotating tunnel
 * hostname in development and on its own hostname in production, and both have to work without a
 * variable that would then be wrong half the time.
 *
 * The scheme is forced to `https` for anything but a loopback host. Behind a tunnel the Worker is
 * reached over plain HTTP, so `new URL(request.url).origin` reads `http://<public host>` — and that
 * string becomes the OAuth `redirectUri` SHOPLINE matches against its registered callback list, and
 * the webhook address SHOPLINE has to call us back on. Both are rejected as `http`. Reading
 * `X-Forwarded-Proto` instead would let the caller choose the scheme; a hostname cannot lie about
 * being loopback.
 */
// `URL.hostname` keeps the brackets on an IPv6 literal, so the bracketed form is the one to match.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export const publicOrigin = (requestUrl: string): string => {
  const url = new URL(requestUrl)

  return LOOPBACK_HOSTS.has(url.hostname) ? url.origin : `https://${url.host}`
}
