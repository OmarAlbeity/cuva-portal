/* =====================================================================
 * Local preview server — try the site on your own computer before
 * deploying. Runs the same API function and the official Netlify Blobs
 * local server (data saved in .netlify/local-blobs).
 *
 *   npm run local            → http://localhost:8888
 *   (Windows PowerShell)     $env:SUPER_ADMIN_PASSWORD="your-password"; npm run local
 *   (macOS / Linux)          SUPER_ADMIN_PASSWORD=your-password npm run local
 *
 * Not used on Netlify itself.
 * ===================================================================== */
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobsServer } from '@netlify/blobs/server';
import { setEnvironmentContext } from '@netlify/blobs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(root, 'public');
const PORT = Number(process.env.PORT) || 8888;

// 1. Local Blobs storage
const blobs = new BlobsServer({ directory: join(root, '.netlify', 'local-blobs'), token: 'local-token' });
const { port: blobsPort } = await blobs.start();
const blobsURL = `http://localhost:${blobsPort}`;
setEnvironmentContext({ edgeURL: blobsURL, uncachedEdgeURL: blobsURL, siteID: 'local-site', token: 'local-token' });

// 2. The same API function Netlify runs
const { default: api } = await import('../netlify/functions/api.mjs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, v]])),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
    });
    const response = await api(request);
    const headers = {};
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') headers[key] = value; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  // Static files with Netlify-style pretty URLs (/passes → passes.html)
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (!extname(pathname)) pathname += '.html';
  const file = normalize(join(PUBLIC_DIR, pathname));
  try {
    if (!file.startsWith(PUBLIC_DIR + sep) || !statSync(file).isFile()) throw new Error('not found');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`CUVA Portal (local preview) → http://localhost:${PORT}`);
  if (!process.env.SUPER_ADMIN_PASSWORD) {
    console.log('Tip: set SUPER_ADMIN_PASSWORD to be able to sign in as the Super Admin (see README).');
  }
});
