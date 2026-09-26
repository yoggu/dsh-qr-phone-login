# dsh-qr-phone-login

Adds a **Plugins → QR phone login** page to DSH Web. A signed-in user can display a QR code that opens the same DSH installation on a phone and signs it in using DSH's launch-token mechanism.

## Install from GitHub

```sh
dsh plugin --profile web add https://github.com/yoggu/dsh-qr-phone-login.git
```

Restart DSH Web if necessary and reload the page. Configure `publicOrigin` on the plugin page to the **HTTPS origin actually served to the phone** (for example `https://dsh.example.com`), with no path or query. The plugin does not set up HTTPS, DNS, Tailscale or a reverse proxy. The phone must be able to reach that origin.

To uninstall: `dsh plugin --profile web remove dsh-qr-phone-login`.

## Security

**Anyone who sees or photographs the displayed QR code can sign in with the same access.** Display it privately; do not share screenshots, logs or SVG responses. The SVG route is protected by DSH's existing browser authentication and Origin checks, and the plugin does not put the launch token into configuration. The token encoded in the QR code is process-wide and reusable until the DSH process restarts; this plugin cannot make it one-time or short-lived. Restart DSH to rotate it if exposed. DSH login cookies can remain valid after that restart until their configured expiry (30 days by default); revoke affected sessions separately where supported. This is suitable only for trusted installations and users.

## Tests and license

Run `npm test` after installing the DSH peer dependencies. MIT; see [LICENSE](LICENSE).
