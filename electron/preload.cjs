// electron/preload.cjs — minimal, sandbox-safe bridge (CommonJS is required for
// sandboxed preload scripts; the rest of the app is ESM).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('lumina', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
});
