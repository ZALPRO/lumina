# Installing Lumina

Lumina runs on **macOS**, **Linux** and **Windows**. There are three ways in:
run from source, use a prebuilt binary from
[Releases](https://github.com/ZALPRO/lumina/releases), or build the packages
yourself. Every command below is copy-paste ready.

- [1. Requirements](#1-requirements)
- [2. Run from source](#2-run-from-source)
- [3. macOS](#3-macos)
- [4. Linux](#4-linux)
- [5. Windows](#5-windows)
- [6. Building packages yourself](#6-building-packages-yourself)
- [7. Troubleshooting](#7-troubleshooting)

---

## 1. Requirements

| | Minimum | Notes |
|---|---|---|
| Node.js | **20.0** (LTS 22 recommended) | only for source runs and builds; the packaged app bundles its own runtime |
| npm | 9+ | ships with Node |
| RAM | 512 MB free | 4 GB+ for large layered documents |
| GPU | not required | rendering is CPU-only and works on headless/remote machines |

Check what you have:

```bash
node -v && npm -v
```

---

## 2. Run from source

Works identically on all three platforms:

```bash
git clone https://github.com/ZALPRO/lumina.git
cd lumina
npm install
```

Then pick one:

```bash
npm run web     # browser app on http://localhost:4173 (no Electron needed)
npm start       # desktop app (Electron window)
npm test        # 269 automated tests
```

`npm install` downloads Electron (~120 MB) only for the desktop shell. If you
just want the web app, you can skip it:

```bash
npm install --omit=dev && npm run web
```

---

## 3. macOS

### Option A — prebuilt (recommended)

1. Download the DMG for your Mac from
   [Releases](https://github.com/ZALPRO/lumina/releases):
   - Apple Silicon (M1/M2/M3/M4): `Lumina-1.0.0-mac-arm64.dmg`
   - Intel: `Lumina-1.0.0-mac-x64.dmg`
2. Open the DMG and drag **Lumina** into **Applications**.
3. **First launch.** Release builds are not signed with an Apple Developer ID
   (that needs a paid account), so macOS Gatekeeper will warn you. Bypass it once:

   **Right-click (or Control-click) the app → Open → Open.**
   Or from the terminal:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Lumina.app
   open /Applications/Lumina.app
   ```

   If you would rather sign it yourself with your own certificate:

   ```bash
   codesign --deep --force --options runtime \
     --sign "Developer ID Application: YOUR NAME (TEAMID)" \
     /Applications/Lumina.app
   ```

4. Architecture check — to see which binary you need:

   ```bash
   uname -m      # arm64 = Apple Silicon, x86_64 = Intel
   ```

> Apple Silicon users can run the x64 build through Rosetta 2, but the native
> `arm64` build is faster; both are attached to each release.

### Option B — from source

```bash
brew install node        # if Node is not installed yet
git clone https://github.com/ZALPRO/lumina.git && cd lumina
npm install && npm start
```

No extra system libraries are required on macOS: Electron uses the system
WebKit/Chromium stack and Lumina itself has zero native dependencies.

---

## 4. Linux

### Option A — AppImage (no installation)

```bash
# x86_64
wget https://github.com/ZALPRO/lumina/releases/download/v1.0.0/Lumina-1.0.0-linux-x86_64.AppImage
chmod +x Lumina-1.0.0-linux-x86_64.AppImage
./Lumina-1.0.0-linux-x86_64.AppImage
```

If FUSE is unavailable (containers, some minimal distros):

```bash
./Lumina-1.0.0-linux-x86_64.AppImage --appimage-extract-and-run
```

### Option B — Debian / Ubuntu (`.deb`)

```bash
sudo apt install ./Lumina-1.0.0-linux-amd64.deb     # apt resolves the dependencies
lumina                                              # launcher is on PATH
```

### Option C — portable tarball

```bash
tar -xzf Lumina-1.0.0-linux-x64.tar.gz
cd Lumina-1.0.0-linux-x64
./lumina
```

### Option D — from source

```bash
git clone https://github.com/ZALPRO/lumina.git && cd lumina
npm install && npm start
```

Electron needs these shared libraries (they are pulled in automatically by the
`.deb`; install manually if you use the tarball or source):

| Distribution | Command |
|---|---|
| Debian 12 / Ubuntu 22.04+ | `sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0 libasound2` |
| Fedora 39+ | `sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-core libuuid libsecret alsa-lib` |
| Arch / Manjaro | `sudo pacman -S gtk3 libnotify nss libxss libxtst xdg-utils at-spi2-core util-linux libsecret alsa-lib` |
| openSUSE Tumbleweed | `sudo zypper install gtk3 libnotify4 mozilla-nss libXScrnSaver libXtst xdg-utils at-spi2-core libuuid libsecret alsa-lib` |
| Alpine (musl) | not supported by Electron — use the Docker recipe in §7 |

Wayland: Electron runs on Wayland through XWayland by default. For native
Wayland, launch with `--ozone-platform=wayland`.

---

## 5. Windows

1. Download from [Releases](https://github.com/ZALPRO/lumina/releases):
   - `Lumina-Setup-1.0.0-win-x64.exe` — installer (lets you pick the folder),
     or
   - `Lumina-1.0.0-win-x64-portable.exe` — single file, no installation.
2. SmartScreen may warn about an unknown publisher (the binaries are not
   code-signed): **More info → Run anyway**.
3. From source instead:

   ```powershell
   git clone https://github.com/ZALPRO/lumina.git
   cd lumina
   npm install
   npm start
   ```

---

## 6. Building packages yourself

electron-builder produces every artifact. Cross-compilation rules:

| Host | Linux targets | Windows targets | macOS targets |
|---|---|---|---|
| Linux | ✅ | ✅ (wine needed for the NSIS installer) | ❌ |
| macOS | ✅ | ✅ | ✅ (also signs/notarises) |
| Windows | ✅ (WSL2 for the `.deb`) | ✅ | ❌ |

```bash
npm run pack          # unpacked directory → release/<platform>-unpacked/
npm run dist:linux    # AppImage + deb + tar.gz
npm run dist:mac      # dmg + zip (arm64 and x64)
npm run dist:win      # portable + NSIS installer
```

macOS packages must be built on a Mac — Apple's tooling is not redistributable.
The bundled GitHub Actions workflow
([`.github/workflows/release.yml`](../.github/workflows/release.yml)) does this
for you: it builds all three platforms on real runners and attaches the files to
a GitHub Release whenever you push a `v*` tag.

Signing (optional):

```bash
# macOS: sign + notarise
export CSC_LINK=/path/to/cert.p12 CSC_KEY_PASSWORD=…
export APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=…
npm run dist:mac

# Windows: sign the installer
export CSC_LINK=/path/to/cert.pfx CSC_KEY_PASSWORD=…
npm run dist:win
```

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `EACCES` when running `npm start` on Linux | `sudo chown -R $USER:$(id -gn) ~/.config/Electron` and retry |
| Electron exits with `Failed to connect to the bus` (containers) | harmless; add `--no-sandbox` in Docker |
| AppImage: `fuse: device not found` | install `libfuse2`, or use `--appimage-extract-and-run` |
| `libgtk-3.so.0: cannot open shared object file` | install the GTK/NSS packages from the table in §4 |
| Port 4173 already in use (`npm run web`) | `PORT=8080 npm run web` |
| Browser UI shows nothing (opened as `file://`) | use `npm run web`; ES modules need HTTP or the desktop shell |
| macOS: "Lumina is damaged and can't be opened" | `xattr -dr com.apple.quarantine /Applications/Lumina.app` |
| Linux: blank window on NVIDIA + Wayland | start with `--disable-gpu` |

Headless/CI usage of the engine (no window at all):

```bash
node cli/demo.js                        # build a sample document → out/demo.png
node tools/verify-psd.mjs               # build + externally validate a PSD
node tools/verify-corpus.mjs --download # check 30 real Photoshop files
```
