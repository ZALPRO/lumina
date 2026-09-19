# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ |
| < 1.0 | ❌ (pre-release snapshots) |

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private reporting flow:

**Security** tab → **Report a vulnerability**
(<https://github.com/ZALPRO/lumina/security/advisories/new>)

If you cannot use that, contact the maintainer listed in
[package.json](package.json). Please include:

- the affected version and platform,
- a minimal reproduction (for file-parsing bugs: the smallest file that triggers
  it, or a hex dump of the malformed structure),
- the impact you believe it has (crash, hang, memory growth, code execution).

We aim to acknowledge within **72 hours** and to publish a fix plus advisory for
confirmed issues. Please give us a reasonable window before public disclosure.

## Threat model

Lumina parses untrusted images. The areas that matter:

| Surface | Notes |
|---|---|
| `src/formats/*` | Parsing of PSD/PSB, PNG, JPEG, TIFF, WebP, GIF, BMP, QOI, DNG, ZIP streams. All length fields are attacker-controlled. |
| `src/formats/deflate.js` | Inflate of compressed image data, with a pure-JS fallback |
| `electron/` | Desktop shell: `app://` file serving inside the app directory, link handling |
| `ui/app.js` | Runs with the privileges of the page only |

Out of scope: images opened by choice from untrusted sources without the user's
involvement, and denial of service caused by deliberately enormous (multi-GB)
documents, which is a resource question rather than a vulnerability.

## Hardening already in place

- The Electron renderer runs with `contextIsolation: true`, `nodeIntegration:
  false`, `sandbox: true`, and a minimal CommonJS preload exposing only version
  information.
- Documents are served over a privileged `app://` scheme restricted to the
  application directory; path traversal outside it returns 403.
- External links are opened in the system browser; in-app navigation to remote
  origins is denied.
- The application makes no network requests of its own; there is no telemetry,
  no updater that fetches remote code, and no cloud dependency.
- Decoders bound their allocations by the declared document size and the actual
  remaining buffer length before reading planes.
- `test/` includes regression tests for past out-of-bounds bugs in the PSD
  reader (flat files, truncated sections).

## Hardening you can apply

- Run the web build behind a reverse proxy if you expose it to a network; it is
  designed for localhost use.
- On macOS, keep Gatekeeper enabled; the unsigned-build bypass in
  [docs/INSTALL.md](docs/INSTALL.md) should be a conscious, one-time choice.
- On Linux, run the AppImage with `--appimage-extract-and-run` inside containers
  rather than granting FUSE access you do not need.

## Credits

Researchers who report valid issues are credited in the release notes, unless
they prefer to stay anonymous.
