import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
function card(language, { origin = 'https://example.com', configured = true, writable = true, mutate = async () => true } = {}) {
  let plugin
  let component
  let cursor = 0
  const states = []
  const form = { getSnapshot: () => ({ status: 'ready', writable, revision: 4, value: { publicOrigin: origin, language } }), mutate }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: value => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof value === 'function' ? value() : value
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useEffect: () => {}, // No subscription, HTTP request, or credential fetch in a render test.
    useCallback: fn => fn,
  }
  runInNewContext(source, {
    URL,
    window: { __ModuleLoader__: { load: value => { plugin = value.factory(name => name === 'react' ? React : {}) } } },
    fetch: () => { throw new Error('unexpected real fetch') },
  })
  plugin.apply({
    configForms: { get: () => form, whileServed: (_names, fn) => fn() },
    effect: fn => fn(),
    slots: { inject: (_name, fn) => fn(), register: (_entry, render) => { component = render } },
  })
  const render = () => { cursor = 0; return component({ api: { form } }) }
  render()
  states[6] = configured ? { configured: true, origin } : null
  return { render, states }
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...tree.children.flatMap(nodes)]
}
function text(tree) {
  if (typeof tree === 'string') return tree
  return tree && typeof tree === 'object' ? tree.children.map(text).join(' ') : ''
}
function button(tree, label) { return nodes(tree).find(node => node.type === 'button' && text(node) === label) }

test('English UI, instructions, accessible QR label, and fallback are complete without network', () => {
  for (const language of [undefined, 'en', 'fr']) {
    const tree = card(language).render()
    const copy = text(tree)
    for (const expected of ['Language', 'Public origin (HTTPS)', 'Save', 'Discard', 'QR code for signing in a phone', 'Sign a phone into this DSH', 'Open the camera app', 'Reload', 'Treat the code like a password.']) assert.ok(copy.includes(expected), expected)
    assert.doesNotMatch(copy, /Öffentlicher|Melde ein|Das Token|Speichern|Neu laden/)
    assert.equal(nodes(tree).find(node => node.type === 'img').props.alt, 'QR code for signing in this phone')
    const select = nodes(tree).find(node => node.type === 'select')
    assert.equal(select.props.value, 'en')
    assert.ok(nodes(tree).some(node => node.type === 'label' && node.props.htmlFor === select.props.id))
  }
})

test('German UI and accessible label remain available', () => {
  const tree = card('de').render()
  assert.match(text(tree), /Öffentlicher Ursprung/)
  assert.match(text(tree), /Melde ein Telefon/)
  assert.match(text(tree), /Behandle den Code wie ein Passwort/)
  assert.equal(nodes(tree).find(node => node.type === 'img').props.alt, 'QR-Code zur Anmeldung dieses Telefons')
})

test('validation, read-only state, and unconfigured warning use English fallback', () => {
  for (const [origin, expected] of [['http://example.com', /must use HTTPS/], ['https://', /valid hostname/], ['https://example.com/path', /without a path/]]) {
    const tree = card(undefined, { origin, writable: false, configured: false }).render()
    assert.match(text(tree), expected)
    assert.match(text(tree), /Host configuration is read-only/)
    assert.match(text(tree), /Host did not provide the configuration/)
    assert.equal(button(tree, 'Save').props.disabled, true)
  }
})

test('language selector uses existing form mutation and exposes safe English save results', async () => {
  for (const outcome of ['success', 'rejected', 'throw']) {
    const calls = []
    const view = card(undefined, { mutate: async (...args) => {
      calls.push(JSON.parse(JSON.stringify(args)))
      if (outcome === 'throw') throw new Error('private detail')
      return outcome === 'success'
    } })
    nodes(view.render()).find(node => node.type === 'select').props.onChange({ target: { value: 'de' } })
    const save = button(view.render(), 'Save')
    assert.equal(save.props.disabled, false)
    save.props.onClick()
    // Flush async continuations across the VM context without any network.
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, [[[
      { op: 'set', path: ['publicOrigin'], value: 'https://example.com' },
      { op: 'set', path: ['language'], value: 'de' },
    ], 4]])
    assert.match(text(view.render()), outcome === 'success' ? /Saved\./ : outcome === 'rejected' ? /Host did not accept/ : /Saving failed/)
    assert.doesNotMatch(text(view.render()), /private detail/)
  }
})
