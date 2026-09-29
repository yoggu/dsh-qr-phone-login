/**
 * Browser half of `dsh-qr-phone-login`: the "DSH QR Phone Login" card on
 * the Plugins settings page.
 *
 * Hand-written in the `window.__ModuleLoader__.load` format — no JSX and no
 * bundler — and declared through `exports["./client"]` plus the `dsh.client`
 * manifest in package.json, which is how the Host discovers and serves a
 * browser bundle.
 *
 * The QR page is registered into `plugins.bundle.config` under this package's
 * bundle name and appears while its Host settings namespace is served.
 *
 * The token is never a value in this module. The card asks the Host for a
 * rendered SVG of the finished login URL and drops that image into the page,
 * so nothing here stores, logs, or re-serves the credential. The summary
 * request returns only the origin and a boolean.
 *
 * @module dsh-qr-phone-login/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-qr-phone-login',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React
    // Reuse the chevron from the other plugin cards. The shell provides
    // `ui-primitives` as part of the client baseline; do not bundle a copy.
    const { IconChevronDownOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** This bundle's id, used as the marker on its injected style tag. */
    const CSS_TAG = 'dsh-qr-phone-login'
    /** Route the Host half registers on the browser carrier. */
    const QR_PHONE_LOGIN_ENDPOINT = '/api/qr-phone-login/info'
    const NS = 'qr-phone-login'
    const BUNDLE_NAME = 'dsh-qr-phone-login'

    /** Accept a host or an HTTPS origin, never a path or credential-bearing URL. */
    function parsePublicOrigin(value) {
      const trimmed = typeof value === 'string' ? value.trim() : ''
      if (trimmed === '') return { value: '', error: '' }
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) && !/^https:\/\//i.test(trimmed)) {
        return { value: '', error: 'The public origin must use HTTPS.' }
      }
      let url
      try {
        url = new URL(/^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
      } catch {
        return { value: '', error: 'Enter a valid hostname or HTTPS origin.' }
      }
      if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
        || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
        return { value: '', error: 'Only an HTTPS origin without a path, credentials, or parameters is allowed.' }
      }
      return { value: url.origin, error: '' }
    }

    // Use Harness theme tokens (`--dsw-alias-*`) for colors and surfaces;
    // hard-coded colors could be unreadable in the other theme.
    const CSS = `
      .qrPhoneLogin{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary)}
      .qrPhoneLoginCard{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;overflow:hidden;transition:border-color .16s,background .16s}
      .qrPhoneLoginCardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
      .qrPhoneLoginHead{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
      .qrPhoneLoginHeadText{min-width:0}
      .qrPhoneLoginHeadRight{display:inline-flex;align-items:center;gap:12px;margin-left:auto}
      .qrPhoneLoginChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
      .qrPhoneLoginChevronOpen{transform:rotate(180deg)}
      .qrPhoneLoginName{margin:0;font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary)}
      .qrPhoneLoginMeta{margin:5px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
      .qrPhoneLoginBody{padding:0 16px 16px}
      .qrPhoneLoginIntro{margin:14px 0 18px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.75}
      .qrPhoneLoginQr{display:flex;justify-content:center;padding:16px;border-radius:12px;background:var(--dsw-alias-bg-layer-3)}
      .qrPhoneLoginQr img{display:block;width:260px;height:260px;max-width:100%;border-radius:6px}
      .qrPhoneLoginPlaceholder{display:flex;align-items:center;justify-content:center;width:260px;height:260px;max-width:100%;border:1px dashed var(--dsw-alias-border-l3);border-radius:8px;color:var(--dsw-alias-label-tertiary);font-size:13px;text-align:center;padding:16px;box-sizing:border-box}
      .qrPhoneLoginSteps{margin:20px 0 0;padding:0 0 0 20px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.8}
      .qrPhoneLoginSteps li{margin:0 0 4px}
      .qrPhoneLoginActions{display:flex;flex-wrap:wrap;gap:9px;margin-top:18px}
      .qrPhoneLoginButton{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:8px 14px;font:600 13px/1.2 inherit;cursor:pointer}
      .qrPhoneLoginButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .qrPhoneLoginButton:disabled{opacity:.45;cursor:not-allowed}
      .qrPhoneLoginButton.primary{border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
      .qrPhoneLoginButton.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}
      .qrPhoneLoginNote{margin:16px 0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:11px 13px;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.7;overflow-wrap:anywhere}
      .qrPhoneLoginWarn{margin:0 0 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px 13px;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.7;overflow-wrap:anywhere}
      .qrPhoneLoginError{margin:0 0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px 13px;color:var(--dsw-alias-label-error);font-size:12.5px;line-height:1.7;overflow-wrap:anywhere}
      .qrPhoneLoginConfig{margin-top:14px;padding:14px 16px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px}
      .qrPhoneLoginConfig label{display:block;margin-bottom:7px;font-size:13px;font-weight:500}
      .qrPhoneLoginConfig input{box-sizing:border-box;width:100%;height:36px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font:inherit;font-size:13px}
      .qrPhoneLoginConfig p{margin:8px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6}
      .qrPhoneLoginConfig .qrPhoneLoginActions{margin-top:12px}
    `

    if (
      typeof document !== 'undefined'
      && document.querySelector(`style[data-plugin="${CSS_TAG}"]`) === null
    ) {
      const style = document.createElement('style')
      style.dataset.plugin = CSS_TAG
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /**
     * Read the deployment summary. Returns only the origin and whether a
     * token is present; the credential itself never rides this response.
     *
     * @returns the parsed summary, or a thrown error for the card to show.
     */
    async function fetchSummary() {
      const response = await fetch(QR_PHONE_LOGIN_ENDPOINT, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`Host responded with ${String(response.status)}`)
      return response.json()
    }

    /** Render the bundle's configuration page, with a token-safe origin editor. */
    function QrPhoneLoginCard(props) {
      const [draft, setDraft] = useState(undefined)
      const [saving, setSaving] = useState(false)
      const [saveError, setSaveError] = useState('')
      const [saved, setSaved] = useState(false)
      const [reloadKey, setReloadKey] = useState(0)
      const [summary, setSummary] = useState(null)
      const [error, setError] = useState(null)
      const form = props.api.form
      const [state, setState] = useState(() => form.getSnapshot())
      const origin = typeof state.value?.publicOrigin === 'string' ? state.value.publicOrigin : ''
      const currentDraft = draft ?? origin
      const parsedOrigin = parsePublicOrigin(currentDraft)
      const dirty = draft !== undefined && draft !== origin

      useEffect(() => form.subscribe(() => { setState(form.getSnapshot()) }), [form])

      useEffect(() => {
        let cancelled = false
        setError(null)
        fetchSummary()
          .then((value) => { if (!cancelled) setSummary(value) })
          .catch((cause) => { if (!cancelled) setError(cause.message) })
        return () => { cancelled = true }
      }, [reloadKey])

      async function saveOrigin() {
        if (!dirty || parsedOrigin.error || !state.writable || saving) return
        setSaving(true)
        setSaveError('')
        setSaved(false)
        try {
          const accepted = await form.mutate(
            [
              parsedOrigin.value === ''
                ? { op: 'unset', path: ['publicOrigin'] }
                : { op: 'set', path: ['publicOrigin'], value: parsedOrigin.value },
            ],
            state.revision,
          )
          if (!accepted) setSaveError('The Host did not accept the change.')
          else { setDraft(undefined); setSaved(true); setReloadKey(key => key + 1) }
        } catch {
          setSaveError('Saving failed. Please try again.')
        } finally {
          setSaving(false)
        }
      }
      const refresh = useCallback(() => { setReloadKey(key => key + 1) }, [])
      // The sign-in QR is the primary purpose of this page, so show it as soon
      // as the page opens rather than hiding it behind an extra click.
      const [open, setOpen] = useState(true)
      const configured = summary?.configured === true

      // The Host serves the QR code as an SVG. Include `reloadKey` in its
      // URL so reloading after a DSH restart requests a fresh image.
      const qrSrc = configured ? `${QR_PHONE_LOGIN_ENDPOINT}?qr=1&r=${String(reloadKey)}` : null

      return h('div', { className: 'qrPhoneLogin' },
        h('section', { className: 'qrPhoneLoginConfig' },
          h('label', { htmlFor: 'qr-phone-public-origin' }, 'Public origin (HTTPS)'),
          h('input', {
            id: 'qr-phone-public-origin',
            type: 'url',
            autoComplete: 'url',
            placeholder: 'https://host.example.ts.net',
            disabled: !state.writable || saving,
            value: currentDraft,
            onChange: (event) => { setDraft(event.target.value); setSaved(false); setSaveError('') },
          }),
          h('p', null, 'Hostname or HTTPS origin without a path. The QR code remains disabled when this field is empty.'),
          parsedOrigin.error ? h('p', { className: 'qrPhoneLoginError', role: 'alert' }, parsedOrigin.error) : null,
          saveError ? h('p', { className: 'qrPhoneLoginError', role: 'alert' }, saveError) : null,
          saved ? h('p', { role: 'status' }, 'Saved.') : null,
          h('div', { className: 'qrPhoneLoginActions' },
            h('button', {
              type: 'button',
              className: 'qrPhoneLoginButton primary',
              disabled: !dirty || Boolean(parsedOrigin.error) || !state.writable || saving,
              onClick: () => { void saveOrigin() },
            }, saving ? 'Saving…' : 'Save'),
            h('button', {
              type: 'button',
              className: 'qrPhoneLoginButton',
              disabled: !dirty || saving,
              onClick: () => { setDraft(undefined); setSaveError(''); setSaved(false) },
            }, 'Discard'),
          ),
          !state.writable ? h('p', null, 'The Host configuration is read-only.') : null,
        ),
        // Match the other plugin cards: a name and short description in the
        // header, with the QR code, instructions, and privacy note shown only
        // while the card is expanded.
        h('div', { className: open ? 'qrPhoneLoginCard qrPhoneLoginCardOpen' : 'qrPhoneLoginCard' },
          h('button', {
            type: 'button',
            className: 'qrPhoneLoginHead',
            'aria-expanded': open,
            onClick: () => { setOpen(value => !value) },
          },
            h('span', { className: 'qrPhoneLoginHeadText' },
              h('h3', { className: 'qrPhoneLoginName' }, 'DSH QR Phone Login'),
              h('p', { className: 'qrPhoneLoginMeta' }, 'QR code for signing in a phone'),
            ),
            h('span', { className: 'qrPhoneLoginHeadRight' },
              h(IconChevronDownOutlineRegular, {
                className: open ? 'qrPhoneLoginChevron qrPhoneLoginChevronOpen' : 'qrPhoneLoginChevron',
              }),
            ),
          ),
          open ? h('div', { className: 'qrPhoneLoginBody' },
            h('p', { className: 'qrPhoneLoginIntro' },
              'Sign a phone into this DSH: scan the QR code with the camera to open an authenticated page. '
                + 'The code contains this DSH process launch token.',
            ),
            error !== null ? h('div', { className: 'qrPhoneLoginError' }, error) : null,
            !configured
              ? h('div', { className: 'qrPhoneLoginWarn' },
                summary?.message ?? 'The Host did not provide the configuration.')
              : h('div', { className: 'qrPhoneLoginQr' },
                qrSrc === null
                  ? h('div', { className: 'qrPhoneLoginPlaceholder' }, 'No QR code available')
                  : h('img', { src: qrSrc, alt: 'QR code for signing in this phone', width: 260, height: 260 }),
              ),
            configured
              ? h('ol', { className: 'qrPhoneLoginSteps' },
                h('li', null, 'Connect Tailscale on the phone and use the Tailscale client DNS.'),
                h('li', null, 'Open the camera app and scan this QR code.'),
                h('li', null, 'Open the suggested link — sign-in is automatic.'),
              )
              : null,
            h('div', { className: 'qrPhoneLoginActions' },
              h('button', {
                type: 'button',
                className: 'qrPhoneLoginButton primary',
                onClick: refresh,
              }, 'Reload'),
            ),
            h('p', { className: 'qrPhoneLoginNote' },
              configured ? `Target: ${summary.origin}. ` : '',
              'The token belongs to this DSH process and is regenerated on every restart. '
                + 'After sign-in it is replaced by a signed cookie in the phone browser. '
                + 'Treat the code like a password.',
            ),
          ) : null,
        ),
      )
    }

    /**
     * Register the card into the Plugins settings page.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const api = {
        form: ctx.configForms.get(NS),
      }
      ctx.effect(
        () => ctx.configForms.whileServed([NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: BUNDLE_NAME,
          inject: () => ({ api }),
        }, QrPhoneLoginCard))),
        'dsh-qr-phone-login: bundle configuration',
      )
    }

    exports.inject = ['slots', 'configForms']
    exports.apply = apply
    return module.exports
  },
})
