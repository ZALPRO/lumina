// electron/main.js — Lumina desktop shell (macOS / Windows / Linux)
//
// The renderer is the same web UI that `npm run web` serves, loaded through a
// custom, privileged `app://` scheme instead of `file://`. That keeps
// `webSecurity` enabled while still allowing native ES modules, fetch() and
// workers — no local HTTP server is spawned by the packaged app.

import { app, BrowserWindow, Menu, shell, protocol, net } from 'electron';
import { join, dirname, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');              // app root (ui/, src/, package.json)
const START_PAGE = 'app://lumina/';   // root of the app; ui/index.html is the default document

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

// A single running instance: opening a second copy focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/** Resolve an `app://` request to a file inside the app bundle, or 403. */
function resolveRequest(requestUrl) {
  const { pathname } = new URL(requestUrl);
  const rel = decodeURIComponent(pathname === '/' || pathname === '' ? '/ui/index.html' : pathname);
  const target = normalize(join(ROOT, rel));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;   // no path traversal
  return target;
}

function buildMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { role: isMac ? 'close' : 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'reload' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/ZALPRO/lumina#readme'),
        },
        {
          label: 'Report an issue',
          click: () => shell.openExternal('https://github.com/ZALPRO/lumina/issues'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if (isMac) win.setWindowButtonVisibility(true);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#17181d',
    autoHideMenuBar: process.platform !== 'darwin',
    title: 'Lumina — Image Editor',
    icon: join(__dirname, 'icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.removeMenu?.();

  win.loadURL(START_PAGE);
  win.webContents.on('did-finish-load', async () => {
    console.log('[lumina] renderer ready');
    // LUMINA_SHOT=<path> captures the window once loaded (used for docs + smoke CI)
    if (process.env.LUMINA_SHOT) {
      await new Promise((r) => setTimeout(r, 1500));
      const image = await win.webContents.capturePage();
      const { writeFileSync } = await import('node:fs');
      writeFileSync(process.env.LUMINA_SHOT, image.toPNG());
      console.log('[lumina] screenshot →', process.env.LUMINA_SHOT);
      if (process.env.LUMINA_SHOT_EXIT) app.quit();
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => console.error('[lumina] renderer gone:', details.reason));

  // External links always open in the user's browser, never in-app.
  if (process.env.LUMINA_DEBUG) {
    win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*'] }, (d) => {
      console.log('[net]', d.statusCode, d.url);
    });
    win.webContents.session.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (d) => {
      console.error('[net error]', d.error, d.url);
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const file = resolveRequest(request.url);
    if (process.env.LUMINA_DEBUG) console.log('[app://]', request.url, '→', file);
    if (!file) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString()).catch((err) => {
      if (process.env.LUMINA_DEBUG) console.error('[app:// missing]', request.url, err.message);
      return new Response('Not found', { status: 404 });
    });
  });

  const win = createWindow();
  buildMenu(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
