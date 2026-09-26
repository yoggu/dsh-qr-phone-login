# dsh-qr-phone-login

Adds a **Plugins → QR phone login** page to DSH Web. A signed-in user can display a QR code that opens the same DSH installation on a phone and signs it in using DSH's launch-token mechanism.

## Install

Install the tagged GitHub release into your DSH Web profile:

```sh
dsh plugin --profile web add 'https://github.com/yoggu/dsh-qr-phone-login.git#v0.1.1'
```

Or download the source and link the local checkout:

```sh
git clone --branch v0.1.1 --depth 1 https://github.com/yoggu/dsh-qr-phone-login.git
cd dsh-qr-phone-login
pnpm install
dsh plugin --profile web add "link:$(pwd)"
```

Keep a linked checkout in place while the plugin is installed. Use the profile you actually run if it is not `web`.

Restart DSH Web if necessary and reload the page. Configure `publicOrigin` on the plugin page to the **HTTPS origin actually served to the phone** (for example `https://dsh.example.com`), with no path or query. The plugin does not set up HTTPS, DNS, Tailscale or a reverse proxy. The phone must be able to reach that origin.

To uninstall: `dsh plugin --profile web remove dsh-qr-phone-login`.

## Security

**Anyone who sees or photographs the displayed QR code can sign in with the same access.** Display it privately; do not share screenshots, logs or SVG responses. The SVG route is protected by DSH's existing browser authentication and Origin checks, and the plugin does not put the launch token into configuration. The token encoded in the QR code is process-wide and reusable until the DSH process restarts; this plugin cannot make it one-time or short-lived. Restart DSH to rotate it if exposed. DSH login cookies can remain valid after that restart until their configured expiry (30 days by default); revoke affected sessions separately where supported. This is suitable only for trusted installations and users.

## Tests and license

Run `npm test` after installing the DSH peer dependencies. MIT; see [LICENSE](LICENSE).
