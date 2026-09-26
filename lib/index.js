/**
 * DSH QR Phone Login — Host half.
 *
 * Serves the two facts a phone needs to sign in to this DSH: the deployment's
 * externally reachable HTTPS origin and the current process launch token. Both
 * come from services the Host already owns, so this plugin stores nothing:
 *
 *   - the origin is deployment configuration (`config.publicOrigin`), because
 *     only the operator knows which name the reverse proxy serves;
 *   - the token comes from `ctx.connection.authenticatedUrl()`, the same
 *     public method `dsh web` uses to print its startup URL. It is read per
 *     request, so a restart that mints a new token is reflected immediately.
 *
 * The browser half asks for an SVG rather than receiving a token string. The
 * SVG and its rendered pixels are still a bearer credential: anyone who can
 * see or fetch the QR can sign in until the Host process restarts.
 *
 * @module dsh-qr-phone-login
 */

import Schema from '@deepseek-ai/schemastery'
import { encodeQr, qrToSvg } from './qr.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'qr-phone-login'

/**
 * The connection service owns the launch token. It is a hard dependency: with
 * no connection there is nothing to authenticate against and the route would
 * only be able to lie.
 */
export const inject = ['connection']

/** Exact Fetch route the browser card reads. */
export const QR_PHONE_LOGIN_PATH = '/api/qr-phone-login/info'

/**
 * Settings namespace this plugin serves. The Plugins bundle configuration
 * page registers its configuration while the Host serves this namespace.
 */
export const QR_PHONE_LOGIN_NAMESPACE = 'qr-phone-login'

/** Query parameter the card uses to request the rendered QR code. */
const QR_PARAM = 'qr'

/** Never let a QR credential or its metadata be cached or embedded elsewhere. */
const RESPONSE_HEADERS = {
  'cache-control': 'private, no-store',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

/**
 * Deployment-varying settings.
 *
 * `publicOrigin` is the name a phone opens. It is required in practice: the
 * launch token is bound to the request authority, so a QR code pointing at
 * `127.0.0.1` would authenticate a cookie for `127.0.0.1` and fail on the
 * phone. Leaving it empty disables the QR code and reports why.
 */
export const Config = Schema.object({
  // dsh-settings exposes live-editable fields through volatile schemas.
  publicOrigin: Schema.string().volatile(),
})

/**
 * Normalize only a bare host or HTTPS origin. Configuration may be edited
 * without the browser form, so this is an authorization boundary, not a UI
 * convenience: never encode a launch token into HTTP, credentials, a path,
 * query or fragment supplied by configuration.
 * @param value - configured host or HTTPS origin.
 * @returns a canonical HTTPS origin, empty string, or null if invalid.
 */
export function normalizeOrigin(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (/\s|\\|%|\?|#|@/u.test(trimmed) || trimmed.startsWith('//')) return null
  const hasScheme = /^https:\/\//i.test(trimmed)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !hasScheme) return null
  // Check the raw authority first: URL parsing otherwise silently discards an
  // empty query/fragment, dot segments, or extra slashes before we see them.
  const authority = hasScheme ? trimmed.slice('https://'.length) : trimmed
  if (!authority || (hasScheme ? !/^[^/]+\/?$/u.test(authority) : authority.includes('/'))) return null
  let url
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== ''
    || !url.hostname) return null
  return url.origin
}

/**
 * Read the launch-token URL for the configured origin.
 *
 * `authenticatedUrl` accepts any base URL and returns it with the process
 * token set as the sole query parameter. It throws when the origin is not a
 * parseable URL, which is reported to the card rather than swallowed.
 *
 * @param ctx - the Host plugin context.
 * @param origin - normalized origin, or an empty string when unconfigured.
 * @returns the login URL, or a message explaining what to configure.
 */
function buildLoginUrl(ctx, origin) {
  if (origin === null) {
    return {
      ok: false,
      reason: 'invalid-origin',
      message: 'Nur ein HTTPS-Ursprung ohne Pfad, Zugangsdaten oder Parameter ist zulässig.',
    }
  }
  if (origin === '') {
    return {
      ok: false,
      reason: 'no-origin',
      message: 'Kein öffentlicher Ursprung konfiguriert. Setze `publicOrigin` in der Plugin-Konfiguration '
        + 'auf den Namen, unter dem dein Telefon dieses DSH erreicht (z. B. https://your-host.example).',
    }
  }
  let loginUrl
  try {
    loginUrl = ctx.connection.authenticatedUrl(origin)
  } catch {
    return {
      ok: false,
      reason: 'invalid-origin',
      message: 'Der konfigurierte Ursprung konnte nicht für die Anmeldung verwendet werden.',
    }
  }
  // Refuse unexpected carrier behavior rather than displaying a QR that sends
  // the credential to another authority or carries extra query data.
  try {
    const url = new URL(loginUrl)
    const tokens = url.searchParams.getAll('token')
    if (typeof loginUrl !== 'string' || loginUrl.includes('#') || loginUrl !== url.href
      || url.origin !== origin || url.pathname !== '/' || url.hash !== ''
      || [...url.searchParams.keys()].length !== 1 || tokens.length !== 1 || !tokens[0]) {
      throw new Error('invalid login URL')
    }
  } catch {
    return {
      ok: false,
      reason: 'invalid-login-url',
      message: 'Der Host hat keinen sicheren Anmeldelink geliefert.',
    }
  }
  return { ok: true, loginUrl }
}

/**
 * Strip the token from a login URL so the response can describe the target
 * without carrying the credential. The QR request is the only path that
 * returns the token-bearing value, and it returns it as an image.
 *
 * @param loginUrl - the token-bearing URL.
 * @returns the origin and path with the query removed.
 */
function redact(loginUrl) {
  try {
    const url = new URL(loginUrl)
    url.search = ''
    return url.href
  } catch {
    return ''
  }
}

/**
 * Compose the card's JSON payload.
 * @param loginUrl - validated launch-token URL.
 * @returns a lossless-JSON view of the deployment's QR phone login facts.
 */
function describe(loginUrl) {
  const url = new URL(loginUrl)
  return {
    configured: true,
    origin: url.origin,
    // Boolean only: whether a token is present, never the token itself.
    hasToken: url.searchParams.has('token'),
    target: redact(loginUrl),
  }
}

/**
 * Answer one card request.
 *
 * Without `?qr` the response is the redacted summary. With `?qr` it is an SVG
 * image of the login URL, which is the one representation that carries the
 * credential and still leaves the browser half nothing to store.
 *
 * @param ctx - the Host plugin context.
 * @param origin - normalized origin.
 * @param request - the incoming Fetch request.
 * @returns the HTTP response.
 */
function respond(ctx, origin, request) {
  const wantsQr = new URL(request.url, 'http://localhost').searchParams.get(QR_PARAM) !== null
  const built = buildLoginUrl(ctx, origin)

  if (!built.ok) {
    return Response.json(
      { configured: false, reason: built.reason, message: built.message },
      { status: 200, headers: RESPONSE_HEADERS },
    )
  }

  if (!wantsQr) {
    return Response.json(describe(built.loginUrl), { headers: RESPONSE_HEADERS })
  }

  let svg
  try {
    svg = qrToSvg(encodeQr(built.loginUrl).matrix, { quiet: 4, scale: 10 })
  } catch {
    return Response.json(
      {
        configured: false,
        reason: 'qr-failed',
        message: 'QR-Code konnte nicht erzeugt werden.',
      },
      { status: 200, headers: RESPONSE_HEADERS },
    )
  }
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      ...RESPONSE_HEADERS,
      'content-security-policy': "default-src 'none'; sandbox",
    },
  })
}

/**
 * Register the card's route on the browser carrier.
 *
 * The route is registered through the connection Fetch registry so it inherits
 * the same Host/Origin fence and browser authentication as `/api`: an
 * unauthenticated caller cannot use this endpoint to read a launch token.
 *
 * @param ctx - the Host plugin context.
 * @param config - resolved plugin config.
 * @returns nothing.
 */
export function apply(ctx, config) {
  // dsh 0.1.7 passes schema refs into apply(); read the current value for
  // every request so a live settings edit takes effect immediately.
  const origin = () => normalizeOrigin(config.publicOrigin.get())

  const register = (connCtx) => {
    connCtx.effect(
      () => connCtx.connection.fetch.register({
        path: QR_PHONE_LOGIN_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => respond(connCtx, origin(), request),
      }),
      'qr-phone-login: QR phone login route',
    )
  }

  // `connection` is injected, so it is already present; the guard keeps this
  // package usable in a composition that mounts it without a browser carrier.
  register(ctx)
}
