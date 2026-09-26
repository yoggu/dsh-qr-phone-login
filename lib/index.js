/**
 * DSH Mobile Authentication — Host half.
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
 * The browser half never handles the token as data: it asks for a ready-made
 * SVG of the finished URL and renders it. That keeps the credential out of
 * component state, out of React props, and out of anything a client-side
 * extension could read off the page.
 *
 * @module dsh-mobile-auth
 */

import Schema from '@deepseek-ai/schemastery'
import { encodeQr, qrToSvg } from './qr.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mobile-auth'

/**
 * The connection service owns the launch token. It is a hard dependency: with
 * no connection there is nothing to authenticate against and the route would
 * only be able to lie.
 */
export const inject = ['connection']

/** Exact Fetch route the browser card reads. */
export const MOBILE_AUTH_PATH = '/api/mobile-auth/info'

/**
 * Settings namespace this plugin serves. The Plugins settings page dispatches
 * `settings.plugin.item` once per namespace the Host actually serves, so
 * installing this section is also what makes the card appear.
 */
export const MOBILE_AUTH_NAMESPACE = 'mobile-auth'

/** Query parameter the card uses to request the rendered QR code. */
const QR_PARAM = 'qr'

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
 * Normalize the configured origin into what a URL needs.
 * @param value - the configured origin, with or without a scheme.
 * @returns an absolute `https://host` origin without a trailing slash.
 */
function normalizeOrigin(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed === '') return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withScheme.replace(/\/+$/u, '')
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
  if (origin === '') {
    return {
      ok: false,
      reason: 'no-origin',
      message: 'Kein öffentlicher Ursprung konfiguriert. Setze `publicOrigin` in der Plugin-Konfiguration '
        + 'auf den Namen, unter dem dein Telefon dieses DSH erreicht (z. B. https://pop-os.tailba240b.ts.net).',
    }
  }
  let loginUrl
  try {
    loginUrl = ctx.connection.authenticatedUrl(origin)
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-origin',
      message: `Der konfigurierte Ursprung ist keine gültige URL: ${error instanceof Error ? error.message : String(error)}`,
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
 * @param ctx - the Host plugin context.
 * @param origin - normalized origin.
 * @returns a lossless-JSON view of the deployment's mobile sign-in facts.
 */
function describe(ctx, origin) {
  const built = buildLoginUrl(ctx, origin)
  if (!built.ok) {
    return { configured: false, reason: built.reason, message: built.message }
  }
  const url = new URL(built.loginUrl)
  return {
    configured: true,
    origin: url.origin,
    // Boolean only: whether a token is present, never the token itself.
    hasToken: url.searchParams.has('token'),
    target: redact(built.loginUrl),
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
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  }

  if (!wantsQr) {
    return Response.json(describe(ctx, origin), { headers: { 'cache-control': 'no-store' } })
  }

  let svg
  try {
    svg = qrToSvg(encodeQr(built.loginUrl).matrix, { quiet: 4, scale: 10 })
  } catch (error) {
    return Response.json(
      {
        configured: false,
        reason: 'qr-failed',
        message: `QR-Code konnte nicht erzeugt werden: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  }
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'no-store',
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
        path: MOBILE_AUTH_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => respond(connCtx, origin(), request),
      }),
      'mobile-auth: mobile sign-in route',
    )
  }

  // `connection` is injected, so it is already present; the guard keeps this
  // package usable in a composition that mounts it without a browser carrier.
  register(ctx)
}
