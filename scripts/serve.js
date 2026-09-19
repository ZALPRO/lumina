// scripts/serve.js — Minimal zero-dependency static dev server
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Security: Only allow serving from ui/ and src/ directories, never internal dotfiles or root config
function isAllowedPath(relPath) {
  const clean = relPath.replace(/^\/+/, '');
  if (!clean || clean === 'ui/index.html') return true;
  // Disallow dotfiles/hidden paths (.git, .env, etc.)
  if (clean.split('/').some((part) => part.startsWith('.'))) return false;
  // Allow ui/ and src/ assets only
  return clean.startsWith('ui/') || clean.startsWith('src/');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/ui/index.html';

    if (!isAllowedPath(p)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const full = normalize(join(ROOT, p));
    if (full !== ROOT && !full.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const body = await readFile(full);
    const ext = extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found: ' + req.url);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Lumina UI: http://${HOST}:${PORT}/`);
});
