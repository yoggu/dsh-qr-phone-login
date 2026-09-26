# dsh-qr-phone-login

A **Plugins → QR phone login** bundle page that lets you set the public HTTPS
origin and shows a scannable QR code for signing a phone in to this DSH.

## What it does

Scan the code with a phone camera; the opened link carries this DSH process's
launch token, so the page arrives already authenticated. DSH then exchanges the
token for a signed `HttpOnly` cookie and redirects to the clean root, exactly as
it does for the URL `dsh web` prints at startup.

The bundle page appears under **Installed → QR phone login** in Plugins. It reads
the deployment summary and rendered code from the Host over
`/api/qr-phone-login/info`, which sits behind the same Host/Origin fence and browser
authentication as every other `/api` route: an unauthenticated caller cannot use
it to obtain a launch token.

## Configuration

| Field | Meaning |
|---|---|
| `publicOrigin` | The name a phone opens, e.g. `https://my-host.example.ts.net`. Required for the QR code. |

The bundle ships an **empty placeholder** because the name belongs to the
deployment, not to the plugin. Set it on the bundle's Plugins detail page, or
configure/override it in your profile's own patch layer:

```yaml
- id: qr-phone-login
  config:
    publicOrigin: 'https://my-host.example.ts.net'
```

`publicOrigin` must be the name the reverse proxy actually serves. The launch
token binds the resulting cookie to the request authority, so a code pointing at
`127.0.0.1` would mint a cookie for `127.0.0.1` that is useless on a phone. With
no `publicOrigin` the card renders an explanation instead of a code.

## Where the token lives

Nowhere this plugin controls. The Host half calls
`ctx.connection.authenticatedUrl(origin)` — the same public method `dsh web` uses
for its startup line — per request. The token is not stored in configuration, not
cached, and never read into the browser half: the card requests a finished SVG
and drops that image into the page, so no component state, prop, or client-side
extension holds the credential. The JSON summary returns the origin and a
boolean only.

The token is regenerated on every DSH restart, so use **Reload** after
restarting the service. Cookies already issued stay valid for their configured
lifetime (`cookieMaxAgeDays`, 30 days by default).

## Requirements

- A public HTTPS origin for this DSH. The plugin does not create one; it reports
  the name you configured.
- The phone must resolve that name. With Tailscale, the phone's Tailscale client
  has to use Tailscale DNS; a conflicting DNS or VPN profile on the phone makes
  the name unresolvable even while the VPN shows as connected.

## Install

1. Link the package into a profile and add it to that profile's bundles:

   ```json
   "dependencies": { "dsh-qr-phone-login": "link:/path/to/dsh-qr-phone-login" },
   "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-qr-phone-login"] } }
   ```

2. Give the package's `node_modules/@deepseek-ai` the peers its host half
   imports (`dsh-client-connection`, `schemastery`, `cordis`). Out-of-tree
   plugins live outside `$DSH_HOME/profiles`, so Node's parent walk cannot reach
   the installation closure; the profile's `$DSH_HOME/profiles/node_modules` is
   the right link target.

3. Set `publicOrigin` on the QR phone login detail page in Plugins, or in the
   profile patch layer (see Configuration above).

4. Restart the Web app once, so the Host half installs the settings namespace
   and route. The QR phone login page then appears under Installed in Plugins.

## Known Limitations and Deferred Work

- `publicOrigin` is a single value. A deployment reachable under several names
  shows a code for one of them; make that value the name you intend phones to
  use.
- The QR encoder in `lib/qr.js` implements versions 1–10 at error correction
  level L, which no realistic login URL reaches. A payload beyond that capacity
  is refused rather than truncated, and the card reports the failure.
