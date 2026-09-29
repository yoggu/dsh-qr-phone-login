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
  states[5] = configured ? { configured: true, origin } : null
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
function originInput(tree) { return nodes(tree).find(node => node.type === 'input') }

test('English UI and accessible QR label ignore legacy languages without network or a language control', () => {
  for (const language of [undefined, 'en', 'de', 'zh', 'fr']) {
    const tree = card(language).render()
    const copy = text(tree)
    for (const expected of ['Public origin (HTTPS)', 'Save', 'Discard', 'QR code for signing in a phone', 'Sign a phone into this DSH', 'Open the camera app', 'Reload', 'Treat the code like a password.']) assert.ok(copy.includes(expected), expected)
    assert.doesNotMatch(copy, /Language|Öffentlicher|Melde ein|Das Token|Speichern|Neu laden/)
    assert.equal(nodes(tree).find(node => node.type === 'img').props.alt, 'QR code for signing in this phone')
    assert.equal(nodes(tree).some(node => node.type === 'select' || node.props.id === 'qr-phone-language' || node.props.htmlFor === 'qr-phone-language'), false)
    const input = originInput(tree)
    assert.ok(nodes(tree).some(node => node.type === 'label' && node.props.htmlFor === input.props.id))
  }
})

test('origin edits enable saving and discard restores the unchanged draft without mutation', () => {
  const calls = []
  const view = card('de', { mutate: async (...args) => { calls.push(args); return true } })
  assert.equal(button(view.render(), 'Save').props.disabled, true)
  originInput(view.render()).props.onChange({ target: { value: 'https://updated.example.com' } })
  assert.equal(originInput(view.render()).props.value, 'https://updated.example.com')
  assert.equal(button(view.render(), 'Save').props.disabled, false)
  button(view.render(), 'Discard').props.onClick()
  assert.equal(originInput(view.render()).props.value, 'https://example.com')
  assert.equal(button(view.render(), 'Save').props.disabled, true)
  assert.deepEqual(calls, [])
})

test('validation, read-only state, and unconfigured warning stay English for legacy languages', () => {
  for (const language of [undefined, 'de', 'zh', 'fr']) {
    for (const [origin, expected] of [['http://example.com', /must use HTTPS/], ['https://', /valid hostname/], ['https://example.com/path', /without a path/]]) {
      const tree = card(language, { origin, writable: false, configured: false }).render()
      assert.match(text(tree), expected)
      assert.match(text(tree), /Host configuration is read-only/)
      assert.match(text(tree), /Host did not provide the configuration/)
      assert.equal(button(tree, 'Save').props.disabled, true)
    }
  }
})

test('origin saves mutate only publicOrigin at the current revision and expose safe English results', async () => {
  for (const language of [undefined, 'de', 'zh', 'fr']) {
    for (const outcome of ['success', 'rejected', 'throw']) {
      const calls = []
      const view = card(language, { mutate: async (...args) => {
        calls.push(JSON.parse(JSON.stringify(args)))
        if (outcome === 'throw') throw new Error('private detail')
        return outcome === 'success'
      } })
      originInput(view.render()).props.onChange({ target: { value: 'https://updated.example.com' } })
      const save = button(view.render(), 'Save')
      assert.equal(save.props.disabled, false)
      save.props.onClick()
      // Flush async continuations across the VM context without any network.
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(calls, [[[
        { op: 'set', path: ['publicOrigin'], value: 'https://updated.example.com' },
      ], 4]])
      assert.match(text(view.render()), outcome === 'success' ? /Saved\./ : outcome === 'rejected' ? /Host did not accept/ : /Saving failed/)
      assert.doesNotMatch(text(view.render()), /private detail/)
    }
  }
})

test('clearing the origin unsets only publicOrigin and leaves legacy language untouched', async () => {
  const calls = []
  const view = card('de', { mutate: async (...args) => {
    calls.push(JSON.parse(JSON.stringify(args)))
    return true
  } })
  originInput(view.render()).props.onChange({ target: { value: '' } })
  const save = button(view.render(), 'Save')
  assert.equal(save.props.disabled, false)
  save.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [[[{ op: 'unset', path: ['publicOrigin'] }], 4]])
  assert.match(text(view.render()), /Saved\./)
})
