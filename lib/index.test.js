import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, Config, normalizeOrigin, QR_PHONE_LOGIN_PATH } from './index.js'

function routeFor(publicOrigin, authenticatedUrl = origin => `${origin}/?token=secret-token`, language) {
  let route
  const ctx = {
    connection: {
      authenticatedUrl,
      fetch: { register(value) { route = value; return () => {} } },
    },
    effect(register) { register() },
  }
  apply(ctx, { publicOrigin: { get: () => publicOrigin }, language: { get: () => language } })
  assert.equal(route.path, QR_PHONE_LOGIN_PATH)
  assert.deepEqual(route.methods, ['GET'])
  return route.fetch
}

async function request(route, qr = false) {
  return route(new Request(`https://dsh.example${QR_PHONE_LOGIN_PATH}${qr ? '?qr' : ''}`))
}

function assertSafeHeaders(response, svg = false) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  if (svg) assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox")
}

test('normalizeOrigin accepts only hosts and bare HTTPS origins', () => {
  for (const [input, expected] of [
    ['', ''], ['  ', ''], ['example.com', 'https://example.com'],
    [' HTTPS://ExAmPlE.com:443/ ', 'https://example.com'],
    ['example.com:8443', 'https://example.com:8443'],
    ['[::1]:8443', 'https://[::1]:8443'],
    ['bücher.example', 'https://xn--bcher-kva.example'],
  ]) assert.equal(normalizeOrigin(input), expected, input)
})

test('normalizeOrigin refuses credential exfiltration and non-origin input', () => {
  for (const input of [
    null, undefined, 12, {}, 'http://example.com', 'ftp://example.com',
    '//example.com', 'https:///example.com', 'https://',
    'https://user:password@example.com', 'user@example.com',
    'https://example.com/path', 'https://example.com//', 'example.com/',
    'https://example.com/.', 'https://example.com/../',
    'https://example.com?', 'https://example.com/?',
    'https://example.com#', 'https://example.com/#',
    'example.com%2fevil.example', 'https://example.com\\evil.example',
    'example.com\n.evil.example', 'example.com:99999',
  ]) assert.equal(normalizeOrigin(input), null, String(input))
})

test('summary is redacted and all successful responses carry security headers', async () => {
  const route = routeFor('HTTPS://example.com:443/')
  const summary = await request(route)
  assertSafeHeaders(summary)
  assert.match(summary.headers.get('content-type'), /^application\/json/)
  assert.deepEqual(await summary.json(), {
    configured: true,
    origin: 'https://example.com',
    hasToken: true,
    target: 'https://example.com/',
  })
  const qr = await request(route, true)
  assertSafeHeaders(qr, true)
  assert.match(qr.headers.get('content-type'), /^image\/svg\+xml/)
  assert.match(await qr.text(), /<svg\b/)
})

test('summary reads the launch token once per request', async () => {
  let calls = 0
  const route = routeFor('example.com', origin => {
    calls += 1
    return `${origin}/?token=secret-${calls}`
  })
  const response = await request(route)
  assert.equal((await response.json()).configured, true)
  assert.equal(calls, 1)
})

test('invalid and missing origins do not call authenticatedUrl and are safely headed', async () => {
  for (const [origin, reason] of [['http://example.com', 'invalid-origin'], ['', 'no-origin']]) {
    const route = routeFor(origin, () => { throw new Error('should not call host') })
    for (const qr of [false, true]) {
      const response = await request(route, qr)
      assertSafeHeaders(response)
      assert.equal((await response.json()).reason, reason)
    }
  }
})

test('host failures and malformed login URLs do not expose credentials', async () => {
  for (const authenticatedUrl of [
    () => { throw new Error('secret-token') },
    () => 'https://evil.example/?token=secret-token',
    () => 'https://example.com/path?token=secret-token',
    () => 'https://example.com/?token=secret-token&token=another',
    () => 'https://example.com/?token=secret-token&extra=1',
    () => 'https://example.com/?token=',
    () => 'https://example.com/?token=secret-token#fragment',
    () => 'https://example.com/?token=secret-token#',
  ]) {
    const route = routeFor('example.com', authenticatedUrl)
    for (const qr of [false, true]) {
      const response = await request(route, qr)
      assertSafeHeaders(response)
      const body = await response.text()
      assert.doesNotMatch(body, /secret-token/)
      assert.equal(JSON.parse(body).configured, false, authenticatedUrl.toString())
    }
  }
})

test('QR encoding failures return a safe, redacted JSON response', async () => {
  const route = routeFor('example.com', origin => `${origin}/?token=${'s'.repeat(1000)}`)
  const response = await request(route, true)
  assertSafeHeaders(response)
  const body = await response.text()
  assert.equal(JSON.parse(body).reason, 'qr-failed')
  assert.doesNotMatch(body, /ssssssss/)
})

test('settings expose English help and English language default', () => {
  assert.equal(Config.dict.language.meta.default, 'en')
  assert.match(Config.dict.language.meta.description, /English/)
  assert.match(Config.dict.publicOrigin.meta.description, /Public HTTPS origin/)
})

test('every host error defaults to English, preserves German, and safely falls back', async () => {
  const cases = [
    ['', undefined, false, /No public origin/, /Kein öffentlicher Ursprung/],
    ['http://example.com', undefined, false, /Only an HTTPS origin/, /Nur ein HTTPS-Ursprung/],
    ['example.com', () => { throw new Error('secret-token') }, false, /could not be used/, /konnte nicht/],
    ['example.com', () => 'https://evil.example/?token=secret-token', false, /safe sign-in link/, /sicheren Anmeldelink/],
    ['example.com', origin => `${origin}/?token=${'s'.repeat(1000)}`, true, /could not be generated/, /konnte nicht erzeugt/],
  ]
  for (const language of [undefined, 'en', 'fr', 'de']) {
    for (const [origin, auth, qr, en, de] of cases) {
      const response = await request(routeFor(origin, auth, language), qr)
      assertSafeHeaders(response)
      const payload = await response.json()
      assert.equal(payload.configured, false)
      assert.match(payload.message, language === 'de' ? de : en)
      assert.doesNotMatch(payload.message, /secret-token|ssssssss/)
    }
  }
})
