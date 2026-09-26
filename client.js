/**
 * Browser half of `dsh-qr-phone-login`: the "DSH QR Phone Login" card on
 * the Plugins settings page.
 *
 * Hand-written in the `window.__ModuleLoader__.load` format — no JSX and no
 * bundler — and declared through `exports["./client"]` plus the `dsh.client`
 * manifest in package.json, which is how the Host discovers and serves a
 * browser bundle.
 *
 * The card is registered into the keyed slot `settings.plugin.item` under the
 * settings namespace this package's Host half serves. The Plugins page
 * dispatches that slot by the namespaces the Host actually serves, so the card
 * appears exactly when the Host half is composed and disappears with it.
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
    // Dasselbe Chevron wie die übrigen Plugin-Karten. `ui-primitives` gehört
    // zum Client-Baseline, wird also vom Shell bereitgestellt und nicht in
    // dieses Bundle kopiert.
    const { IconChevronDownOutline14 } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** This bundle's id, used as the marker on its injected style tag. */
    const CSS_TAG = 'dsh-qr-phone-login'
    /** Route the Host half registers on the browser carrier. */
    const ENDPOINT = '/api/mobile-auth/info'

    // Farben und Flächen kommen ausschließlich aus den Theme-Tokens des
    // Harness (`--dsw-alias-*`); eigene Hex-Werte wären im jeweils anderen
    // Theme unlesbar.
    const CSS = `
      .mobileAuth{color:var(--dsw-alias-label-primary)}
      .mobileAuthCard{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;overflow:hidden;transition:border-color .16s,background .16s}
      .mobileAuthCardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
      .mobileAuthHead{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
      .mobileAuthHeadText{min-width:0}
      .mobileAuthHeadRight{display:inline-flex;align-items:center;gap:12px;margin-left:auto}
      .mobileAuthChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
      .mobileAuthChevronOpen{transform:rotate(180deg)}
      .mobileAuthName{margin:0;font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary)}
      .mobileAuthMeta{margin:5px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
      .mobileAuthBody{padding:0 16px 16px}
      .mobileAuthIntro{margin:14px 0 18px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.75}
      .mobileAuthQr{display:flex;justify-content:center;padding:16px;border-radius:12px;background:var(--dsw-alias-bg-layer-3)}
      .mobileAuthQr img{display:block;width:260px;height:260px;max-width:100%;border-radius:6px}
      .mobileAuthPlaceholder{display:flex;align-items:center;justify-content:center;width:260px;height:260px;max-width:100%;border:1px dashed var(--dsw-alias-border-l3);border-radius:8px;color:var(--dsw-alias-label-tertiary);font-size:13px;text-align:center;padding:16px;box-sizing:border-box}
      .mobileAuthSteps{margin:20px 0 0;padding:0 0 0 20px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.8}
      .mobileAuthSteps li{margin:0 0 4px}
      .mobileAuthActions{display:flex;flex-wrap:wrap;gap:9px;margin-top:18px}
      .mobileAuthButton{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:8px 14px;font:600 13px/1.2 inherit;cursor:pointer}
      .mobileAuthButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .mobileAuthButton:disabled{opacity:.45;cursor:not-allowed}
      .mobileAuthButton.primary{border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
      .mobileAuthButton.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}
      .mobileAuthNote{margin:16px 0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:11px 13px;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.7;overflow-wrap:anywhere}
      .mobileAuthWarn{margin:0 0 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px 13px;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.7;overflow-wrap:anywhere}
      .mobileAuthError{margin:0 0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px 13px;color:var(--dsw-alias-label-error);font-size:12.5px;line-height:1.7;overflow-wrap:anywhere}
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
      const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`Host antwortete mit ${String(response.status)}`)
      return response.json()
    }

    /** Render one card. */
    function QrPhoneLoginCard() {
      const [summary, setSummary] = useState(null)
      const [error, setError] = useState(null)
      const [reloadKey, setReloadKey] = useState(0)
      // Wie bei den übrigen Plugin-Karten startet die Karte zugeklappt.
      const [open, setOpen] = useState(false)

      useEffect(() => {
        let cancelled = false
        setError(null)
        fetchSummary()
          .then((value) => { if (!cancelled) setSummary(value) })
          .catch((cause) => { if (!cancelled) setError(cause.message) })
        return () => { cancelled = true }
      }, [reloadKey])

      const refresh = useCallback(() => { setReloadKey(key => key + 1) }, [])
      const configured = summary?.configured === true

      // Der QR-Code wird als SVG vom Host geliefert. `reloadKey` wandert in die
      // URL, damit ein Neuladen nach einem DSH-Neustart wirklich neu anfragt.
      const qrSrc = configured ? `${ENDPOINT}?qr=1&r=${String(reloadKey)}` : null

      return h('div', { className: 'mobileAuth' },
        // Eine einzige Karte, wie die übrigen Plugin-Karten: der Kopf trägt den
        // Namen und eine kurze Beschreibung, der Körper darunter erscheint nur
        // im offenen Zustand und enthält QR-Code, Schritte und Hinweis.
        h('div', { className: open ? 'mobileAuthCard mobileAuthCardOpen' : 'mobileAuthCard' },
          h('button', {
            type: 'button',
            className: 'mobileAuthHead',
            'aria-expanded': open,
            onClick: () => { setOpen(value => !value) },
          },
            h('span', { className: 'mobileAuthHeadText' },
              h('h3', { className: 'mobileAuthName' }, 'DSH QR Phone Login'),
              h('p', { className: 'mobileAuthMeta' }, 'QR-Code zur Anmeldung eines Telefons'),
            ),
            h('span', { className: 'mobileAuthHeadRight' },
              h(IconChevronDownOutline14, {
                className: open ? 'mobileAuthChevron mobileAuthChevronOpen' : 'mobileAuthChevron',
              }),
            ),
          ),
          open ? h('div', { className: 'mobileAuthBody' },
            h('p', { className: 'mobileAuthIntro' },
              'Melde ein Telefon in diesem DSH an: QR-Code mit der Kamera scannen, die Seite öffnet sich '
              + 'bereits authentifiziert. Der Code enthält das Start-Token dieses DSH-Prozesses.',
            ),
            error !== null ? h('div', { className: 'mobileAuthError' }, error) : null,
            !configured
              ? h('div', { className: 'mobileAuthWarn' },
                summary?.message ?? 'Der Host hat die Konfiguration nicht geliefert.')
              : h('div', { className: 'mobileAuthQr' },
                qrSrc === null
                  ? h('div', { className: 'mobileAuthPlaceholder' }, 'Kein QR-Code verfügbar')
                  : h('img', { src: qrSrc, alt: 'QR-Code zur Anmeldung dieses Telefons', width: 260, height: 260 }),
              ),
            configured
              ? h('ol', { className: 'mobileAuthSteps' },
                h('li', null, 'Tailscale auf dem Telefon verbinden und den DNS des Tailscale-Clients verwenden.'),
                h('li', null, 'Kamera-App öffnen und diesen QR-Code scannen.'),
                h('li', null, 'Den angebotenen Link öffnen — die Anmeldung läuft automatisch.'),
              )
              : null,
            h('div', { className: 'mobileAuthActions' },
              h('button', {
                type: 'button',
                className: 'mobileAuthButton primary',
                onClick: refresh,
              }, 'Neu laden'),
            ),
            h('p', { className: 'mobileAuthNote' },
              configured ? `Ziel: ${summary.origin}. ` : '',
              'Das Token gilt für diesen DSH-Prozess und wird bei jedem Neustart neu erzeugt. '
              + 'Der QR-Code ersetzt es danach durch ein signiertes Cookie im Browser des Telefons. '
              + 'Behandle den Code wie ein Passwort.',
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
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: 'mobile-auth',
      }, QrPhoneLoginCard))
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
